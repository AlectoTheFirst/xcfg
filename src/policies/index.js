import { PolicyEngine } from '../core/policy.js';
import {
  firewallAllowAnyServicePolicy,
  firewallUnknownServicePolicy
} from './firewallRuleBroadness.js';

export const DEFAULT_POLICY_CONFIG = {
  default: {
    mode: 'enforce',
    firewall: {
      allow_rules: {
        any_service: {
          mode: 'enforce',
          min_prefixlen: 16,
          require_explicit: true
        },
        unknown_service: {
          mode: 'warn'
        }
      }
    }
  },
  profiles: []
};

export function createPolicyEngine(policyConfig, envelope, plan) {
  const config = normalizePolicyConfig(policyConfig);
  const selection = selectPolicySettings(config, envelope, plan);
  const settings = selection.settings;

  const globalMode = normalizeMode(settings?.mode);
  const anyServiceMode = normalizeMode(
    settings?.firewall?.allow_rules?.any_service?.mode ?? globalMode
  );
  const anyMinPrefixLen = normalizeNullablePrefixLen(
    settings?.firewall?.allow_rules?.any_service?.min_prefixlen
  );
  const requireExplicitAny =
    settings?.firewall?.allow_rules?.any_service?.require_explicit !== false;

  const unknownServiceMode = normalizeMode(
    settings?.firewall?.allow_rules?.unknown_service?.mode ?? globalMode
  );

  const rules = [];
  if (anyServiceMode !== 'disabled') {
    rules.push(
      firewallAllowAnyServicePolicy({
        mode: anyServiceMode,
        anyMinPrefixLen,
        requireExplicitAny
      })
    );
  }
  if (unknownServiceMode !== 'disabled') {
    rules.push(
      firewallUnknownServicePolicy({
        mode: unknownServiceMode
      })
    );
  }

  const engine = new PolicyEngine(rules);
  return {
    async evaluate(ctx) {
      const result = await engine.evaluate(ctx);
      return { ...result, selection };
    }
  };
}

function normalizePolicyConfig(config) {
  if (!config || typeof config !== 'object') return DEFAULT_POLICY_CONFIG;

  const isNewShape = Array.isArray(config.profiles) || config.default?.firewall?.allow_rules;
  if (isNewShape) {
    return {
      default: isPlainObject(config.default) ? config.default : DEFAULT_POLICY_CONFIG.default,
      profiles: Array.isArray(config.profiles) ? config.profiles : []
    };
  }

  // Backward-compat: old `{ default, environments }` shape.
  const legacyDefault = isPlainObject(config.default) ? config.default : {};
  const legacyMinPrefix =
    legacyDefault.firewall?.any_min_prefixlen ?? DEFAULT_POLICY_CONFIG.default.firewall.allow_rules.any_service.min_prefixlen;
  const legacyMode = legacyDefault.mode ?? DEFAULT_POLICY_CONFIG.default.mode;

  const migrated = {
    default: {
      mode: legacyMode,
      firewall: {
        allow_rules: {
          any_service: {
            mode: legacyMode,
            min_prefixlen: legacyMinPrefix,
            require_explicit: true
          },
          unknown_service: {
            mode: 'warn'
          }
        }
      }
    },
    profiles: []
  };

  if (isPlainObject(config.environments)) {
    for (const [envName, envProfile] of Object.entries(config.environments)) {
      if (!envName || typeof envName !== 'string') continue;
      if (!isPlainObject(envProfile)) continue;
      migrated.profiles.push({
        name: `env:${envName}`,
        priority: 10,
        match: { environment: envName },
        override: envProfile
      });
    }
  }

  return migrated;
}

function selectPolicySettings(config, envelope, plan) {
  const env = inferEnvironment(envelope);
  const planTasks = plan?.tasks ?? [];
  const backends = uniqueStrings(planTasks.map(t => t?.backend));
  const actions = uniqueStrings(planTasks.map(t => t?.action));

  const context = { envelope, plan, environment: env, backends, actions };

  const matched = [];
  for (const profile of config.profiles ?? []) {
    if (!isPlainObject(profile)) continue;
    const match = isPlainObject(profile.match) ? profile.match : {};
    if (!matchesProfile(match, context)) continue;
    matched.push({
      name: typeof profile.name === 'string' ? profile.name : 'unnamed',
      priority: Number.isFinite(profile.priority) ? profile.priority : 0,
      override: isPlainObject(profile.override) ? profile.override : {}
    });
  }

  matched.sort((a, b) => a.priority - b.priority);

  let settings = deepMerge(
    deepMerge({}, DEFAULT_POLICY_CONFIG.default),
    config.default ?? {}
  );
  for (const p of matched) {
    settings = deepMerge(settings, p.override);
  }

  return {
    environment: env,
    matched_profiles: matched.map(p => ({ name: p.name, priority: p.priority })),
    settings
  };
}

function inferEnvironment(envelope) {
  const tagEnv = envelope?.tags?.environment;
  if (typeof tagEnv === 'string' && tagEnv.trim() !== '') return tagEnv.trim();
  const targetEnv = envelope?.target?.environment;
  if (typeof targetEnv === 'string' && targetEnv.trim() !== '') {
    return targetEnv.trim();
  }
  return undefined;
}

function matchesProfile(match, context) {
  for (const [rawKey, expected] of Object.entries(match)) {
    if (rawKey === '$or') {
      if (!Array.isArray(expected) || expected.length === 0) return false;
      if (!expected.some(sub => isPlainObject(sub) && matchesProfile(sub, context))) {
        return false;
      }
      continue;
    }

    const actual = readMatchValue(context, rawKey);
    if (!matchValue(actual, expected)) return false;
  }
  return true;
}

function readMatchValue(context, key) {
  if (key === 'environment') return context.environment;
  if (key === 'type') return context.envelope?.type;
  if (key === 'type_version') return context.envelope?.type_version;
  if (key === 'operation') return context.envelope?.operation;

  if (key === 'plan.backends') return context.backends;
  if (key === 'plan.actions') return context.actions;
  if (key === 'backend') return context.backends.length === 1 ? context.backends[0] : undefined;

  if (key.startsWith('tags.')) return getPath(context.envelope?.tags, key.slice('tags.'.length));
  if (key.startsWith('target.')) return getPath(context.envelope?.target, key.slice('target.'.length));
  if (key.startsWith('requested_by.')) {
    return getPath(context.envelope?.requested_by, key.slice('requested_by.'.length));
  }
  if (key.startsWith('payload.')) return getPath(context.envelope?.payload, key.slice('payload.'.length));

  return undefined;
}

function matchValue(actual, expected) {
  if (Array.isArray(expected)) {
    return expected.some(value => matchValue(actual, value));
  }
  if (Array.isArray(actual)) {
    return actual.includes(expected);
  }
  return actual === expected;
}

function getPath(value, path) {
  if (!path) return value;
  const parts = path.split('.').filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

function deepMerge(base, override) {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return clone(override);

  /** @type {Record<string, any>} */
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v === undefined) continue;
    const existing = out[k];
    if (isPlainObject(existing) && isPlainObject(v)) {
      out[k] = deepMerge(existing, v);
    } else {
      out[k] = clone(v);
    }
  }
  return out;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isPlainObject(value)) return deepMerge({}, value);
  return value;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function normalizeMode(value) {
  const raw = typeof value === 'string' ? value.toLowerCase() : 'enforce';
  if (raw === 'disabled' || raw === 'off') return 'disabled';
  if (raw === 'warn') return 'warn';
  return 'enforce';
}

function normalizeNullablePrefixLen(value) {
  if (value === null) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return 16;
  const prefix = Math.trunc(n);
  if (prefix < 0) return 0;
  if (prefix > 32) return 32;
  return prefix;
}
