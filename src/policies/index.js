import { PolicyEngine } from '../core/policy.js';
import { firewallRuleBroadnessPolicy } from './firewallRuleBroadness.js';

export function createDefaultPolicyEngine(env = process.env) {
  const modeRaw = String(env.XCFG_POLICY_MODE ?? 'enforce').toLowerCase();
  const mode =
    modeRaw === 'disabled' || modeRaw === 'off'
      ? 'disabled'
      : modeRaw === 'warn'
        ? 'warn'
        : 'enforce';

  const anyMaxAddresses = parsePositiveInt(
    env.XCFG_POLICY_FIREWALL_ANY_MAX_ADDRESSES,
    65536
  );

  return new PolicyEngine([
    firewallRuleBroadnessPolicy({ mode, anyMaxAddresses })
  ]);
}

function parsePositiveInt(value, defaultValue) {
  if (value === undefined || value === null) return defaultValue;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return defaultValue;
  return n;
}

