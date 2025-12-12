import { PolicyEngine } from '../core/policy.js';
import { firewallRuleBroadnessPolicy } from './firewallRuleBroadness.js';

export const DEFAULT_POLICY_CONFIG = {
  default: {
    mode: 'enforce',
    firewall: {
      any_min_prefixlen: 16
    }
  },
  environments: {}
};

export function createPolicyEngine(policyConfig, envelope) {
  const config = normalizePolicyConfig(policyConfig);
  const environment = inferEnvironment(envelope);
  const profile =
    (environment && config.environments?.[environment]) ?? config.default;

  const mode = normalizeMode(profile?.mode);
  const anyMinPrefixLen = normalizePrefixLen(
    profile?.firewall?.any_min_prefixlen
  );

  return new PolicyEngine([
    firewallRuleBroadnessPolicy({ mode, anyMinPrefixLen })
  ]);
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

function normalizePolicyConfig(config) {
  if (!config || typeof config !== 'object') return DEFAULT_POLICY_CONFIG;
  return {
    default: config.default ?? DEFAULT_POLICY_CONFIG.default,
    environments: config.environments ?? {}
  };
}

function normalizeMode(value) {
  const raw = typeof value === 'string' ? value.toLowerCase() : 'enforce';
  if (raw === 'disabled' || raw === 'off') return 'disabled';
  if (raw === 'warn') return 'warn';
  return 'enforce';
}

function normalizePrefixLen(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 16;
  const prefix = Math.trunc(n);
  if (prefix < 0) return 0;
  if (prefix > 32) return 32;
  return prefix;
}
