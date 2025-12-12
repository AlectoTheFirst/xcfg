import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultPolicyEngine } from '../src/policies/index.js';

test('policy denies broad firewall allow with ANY service', async () => {
  const policy = createDefaultPolicyEngine({
    XCFG_POLICY_MODE: 'enforce',
    XCFG_POLICY_FIREWALL_ANY_MAX_ADDRESSES: '65536'
  });

  const ctx = {
    request_id: 'req-1',
    envelope: {
      type: 'firewall-rule-change',
      payload: {}
    },
    plan: {
      tasks: [
        {
          id: 't1',
          backend: 'checkpoint',
          action: 'firewall.rule.add',
          input: {
            rule: {
              name: 'broad-any',
              action: 'allow',
              source: [{ cidr: '10.0.0.0/8' }],
              destination: [{ cidr: '11.0.0.0/8' }],
              services: [{ any: true }]
            }
          }
        }
      ]
    }
  };

  const result = await policy.evaluate(ctx);
  assert.equal(result.decision, 'deny');
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].id, 'firewall-any-too-broad');
});

test('policy warns (but allows) when mode=warn', async () => {
  const policy = createDefaultPolicyEngine({
    XCFG_POLICY_MODE: 'warn',
    XCFG_POLICY_FIREWALL_ANY_MAX_ADDRESSES: '65536'
  });

  const result = await policy.evaluate({
    request_id: 'req-1',
    envelope: { type: 'firewall-rule-change', payload: {} },
    plan: {
      tasks: [
        {
          id: 't1',
          backend: 'checkpoint',
          action: 'firewall.rule.add',
          input: {
            rule: {
              name: 'broad-any',
              action: 'allow',
              source: [{ cidr: '10.0.0.0/8' }],
              destination: [{ cidr: '11.0.0.0/8' }],
              services: [{ any: true }]
            }
          }
        }
      ]
    }
  });

  assert.equal(result.decision, 'allow');
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].effect, 'warn');
});

