/**
 * Firewall guardrail policies (POC).
 *
 * These policies are intentionally simple and primarily operate on:
 * - the translated plan (backend-neutral)
 * - explicit payload fields (e.g., CIDRs)
 *
 * Real deployments typically need resolution (object/group → CIDR, service objects, zones),
 * which can be layered in later via a SoT/lookup step before policy evaluation.
 */

/**
 * Deny/warn on allow rules using ANY service for broad networks.
 *
 * If `anyMinPrefixLen` is `undefined`, ANY service is always considered a violation.
 *
 * @param {{ mode: 'disabled'|'warn'|'enforce', anyMinPrefixLen: (number|undefined), requireExplicitAny: boolean }} opts
 */
export function firewallAllowAnyServicePolicy(opts) {
  const mode = opts.mode;
  const anyMinPrefixLen = opts.anyMinPrefixLen;
  const requireExplicitAny = opts.requireExplicitAny;

  return {
    id: 'firewall-allow-any-service',

    evaluate(ctx) {
      if (mode === 'disabled') return [];
      const envelope = ctx.envelope;
      if (!envelope || envelope.type !== 'firewall-rule-change') return [];

      const planTasks = ctx.plan?.tasks ?? [];
      const ruleTasks = planTasks.filter(
        t => typeof t?.action === 'string' && t.action.startsWith('firewall.rule.')
      );

      const violations = [];
      for (const task of ruleTasks) {
        const input = task?.input ?? envelope.payload;
        const rule = input?.rule;
        if (!rule || typeof rule !== 'object') continue;
        if (rule.action !== 'allow') continue;

        const services = Array.isArray(rule.services) ? rule.services : [];
        const classification = classifyServices(services);
        const anyService = requireExplicitAny ? classification.any : classification.any || classification.unknown;
        if (!anyService) continue;

        const sourceCidrs = extractCidrs(rule.source);
        const destCidrs = extractCidrs(rule.destination);

        const broadSource = findBroadestCidr(sourceCidrs);
        const broadDest = findBroadestCidr(destCidrs);

        const sourceTooBroad =
          anyMinPrefixLen === undefined
            ? true
            : !!(broadSource && broadSource.prefix < anyMinPrefixLen);
        const destTooBroad =
          anyMinPrefixLen === undefined
            ? true
            : !!(broadDest && broadDest.prefix < anyMinPrefixLen);

        if (!sourceTooBroad && !destTooBroad) continue;

        const effect = mode === 'enforce' ? 'deny' : 'warn';
        const threshold = anyMinPrefixLen === undefined ? 'any' : `/${anyMinPrefixLen}`;
        const message = [
          'Firewall allow rule too broad with ANY service',
          sourceTooBroad ? `src=${broadSource?.cidr ?? 'unknown'}` : undefined,
          destTooBroad ? `dst=${broadDest?.cidr ?? 'unknown'}` : undefined,
          `threshold=${threshold}`
        ]
          .filter(Boolean)
          .join(' ');

        violations.push({
          id: 'firewall-any-too-broad',
          effect,
          message,
          data: {
            rule_name: rule.name,
            source_broadest: broadSource,
            destination_broadest: broadDest,
            anyMinPrefixLen,
            requireExplicitAny
          }
        });
      }

      return violations;
    }
  };
}

/**
 * Deny/warn on ambiguous/unknown service entries (to prevent accidental "ANY").
 * @param {{ mode: 'disabled'|'warn'|'enforce' }} opts
 */
export function firewallUnknownServicePolicy(opts) {
  const mode = opts.mode;

  return {
    id: 'firewall-unknown-service',

    evaluate(ctx) {
      if (mode === 'disabled') return [];
      const envelope = ctx.envelope;
      if (!envelope || envelope.type !== 'firewall-rule-change') return [];

      const planTasks = ctx.plan?.tasks ?? [];
      const ruleTasks = planTasks.filter(
        t => typeof t?.action === 'string' && t.action.startsWith('firewall.rule.')
      );

      const violations = [];
      for (const task of ruleTasks) {
        const input = task?.input ?? envelope.payload;
        const rule = input?.rule;
        if (!rule || typeof rule !== 'object') continue;
        if (rule.action !== 'allow') continue;

        const services = Array.isArray(rule.services) ? rule.services : [];
        const classification = classifyServices(services);
        if (!classification.unknown) continue;

        const effect = mode === 'enforce' ? 'deny' : 'warn';
        violations.push({
          id: 'firewall-service-unknown',
          effect,
          message: 'Firewall allow rule has unknown/ambiguous service entries',
          data: { rule_name: rule.name }
        });
      }

      return violations;
    }
  };
}

function extractCidrs(endpoints) {
  if (!Array.isArray(endpoints)) return [];
  const cidrs = [];
  for (const entry of endpoints) {
    if (typeof entry === 'string') {
      cidrs.push(entry);
      continue;
    }
    const cidr = entry?.cidr;
    if (typeof cidr === 'string' && cidr.trim() !== '') {
      cidrs.push(cidr);
    }
  }
  return cidrs;
}

function findBroadestCidr(cidrs) {
  let best = undefined;
  for (const cidr of cidrs) {
    const parsed = parseIpv4Cidr(cidr);
    if (!parsed) continue;
    if (!best || parsed.prefix < best.prefix) best = parsed;
  }
  return best;
}

function parseIpv4Cidr(cidr) {
  if (typeof cidr !== 'string') return undefined;
  const trimmed = cidr.trim();
  const slash = trimmed.indexOf('/');
  if (slash <= 0) return undefined;
  const ip = trimmed.slice(0, slash);
  const prefixStr = trimmed.slice(slash + 1);

  if (!isValidIpv4(ip)) return undefined;
  const prefix = Number(prefixStr);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return undefined;
  return { cidr: `${ip}/${prefix}`, prefix };
}

function isValidIpv4(ip) {
  if (typeof ip !== 'string') return false;
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (part.trim() === '') return false;
    if (!/^\d{1,3}$/.test(part)) return false;
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return false;
  }
  return true;
}

function classifyServices(services) {
  const result = { any: false, unknown: false };

  if (!Array.isArray(services) || services.length === 0) {
    result.unknown = true;
    return result;
  }

  const noPortProtocols = new Set(['icmp', 'gre', 'esp', 'ah', 'ip']);

  for (const service of services) {
    if (!service || typeof service !== 'object') {
      result.unknown = true;
      continue;
    }

    if (service.any === true) {
      result.any = true;
      continue;
    }

    if (hasNonEmptyString(service.service_id) || hasNonEmptyString(service.name)) {
      continue;
    }

    const protocol = hasNonEmptyString(service.protocol)
      ? String(service.protocol).trim().toLowerCase()
      : '';
    const port = service.port;

    if (protocol === 'any' || protocol === '*') {
      result.any = true;
      continue;
    }

    if (portIsAny(port)) {
      result.any = true;
      continue;
    }

    const hasProtocol = protocol !== '';
    const hasPort = port !== undefined && port !== null && String(port).trim() !== '';

    if (hasProtocol && !hasPort && noPortProtocols.has(protocol)) {
      continue;
    }

    if (hasProtocol && hasPort) {
      continue;
    }

    result.unknown = true;
  }

  return result;
}

function portIsAny(port) {
  if (typeof port === 'number') return port <= 0;
  if (typeof port === 'string') {
    const p = port.trim().toLowerCase();
    return p === 'any' || p === '*' || p === '';
  }
  return false;
}

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}
