/**
 * Policy: prevent overly broad firewall allow rules with "ANY" service.
 *
 * This is intentionally opinionated and simple for the POC.
 * It evaluates the translated plan so it can work consistently across backends.
 */

/**
 * @param {{ mode: 'disabled'|'warn'|'enforce', anyMaxAddresses: number }} opts
 */
export function firewallRuleBroadnessPolicy(opts) {
  const mode = opts.mode;
  const anyMaxAddresses = opts.anyMaxAddresses;

  return {
    id: 'firewall-rule-broadness',

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
        const anyService = services.some(serviceIsAny);
        if (!anyService) continue;

        const sourceCidrs = extractCidrs(rule.source);
        const destCidrs = extractCidrs(rule.destination);

        const broadSource = findBroadestCidr(sourceCidrs);
        const broadDest = findBroadestCidr(destCidrs);

        const sourceTooBroad =
          broadSource && broadSource.addresses > anyMaxAddresses;
        const destTooBroad = broadDest && broadDest.addresses > anyMaxAddresses;

        if (!sourceTooBroad && !destTooBroad) continue;

        const effect = mode === 'enforce' ? 'deny' : 'warn';
        const message = [
          'Firewall allow rule too broad with ANY service',
          sourceTooBroad ? `src=${broadSource.cidr}` : undefined,
          destTooBroad ? `dst=${broadDest.cidr}` : undefined,
          `max_addresses=${anyMaxAddresses}`
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
            anyMaxAddresses
          }
        });
      }

      return violations;
    }
  };
}

function serviceIsAny(service) {
  if (!service || typeof service !== 'object') return true;
  if (service.any === true) return true;

  const protocol = typeof service.protocol === 'string' ? service.protocol : '';
  if (!protocol) return true;
  if (protocol.toLowerCase() === 'any' || protocol === '*') return true;

  if (typeof service.port === 'number') {
    return service.port <= 0;
  }
  if (typeof service.port === 'string') {
    const p = service.port.trim().toLowerCase();
    return p === 'any' || p === '*' || p === '';
  }

  return true;
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
    if (!best || parsed.addresses > best.addresses) best = parsed;
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
  const addresses = 2 ** (32 - prefix);
  return { cidr: `${ip}/${prefix}`, prefix, addresses };
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

