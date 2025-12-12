import test from 'node:test';
import assert from 'node:assert/strict';

import { createPolicyEngine } from '../src/policies/index.js';

test('policy denies broad firewall allow with ANY service', async () => {
  const policy = createPolicyEngine(
    {
      default: {
        mode: 'enforce',
        firewall: {
          allow_rules: {
            any_service: { mode: 'enforce', min_prefixlen: 16 },
            unknown_service: { mode: 'warn' }
          }
        }
      }
    },
    { tags: { environment: 'prod' } }
  );

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
  const policy = createPolicyEngine(
    {
      default: {
        mode: 'warn',
        firewall: {
          allow_rules: {
            any_service: { mode: 'warn', min_prefixlen: 16 },
            unknown_service: { mode: 'warn' }
          }
        }
      }
    },
    { tags: { environment: 'dev' } }
  );

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

test('policy can be pinned to metadata (disable ANY in mgmt zone)', async () => {
  const policy = createPolicyEngine(
    {
      default: {
        mode: 'enforce',
        firewall: {
          allow_rules: {
            any_service: { mode: 'enforce', min_prefixlen: 16 },
            unknown_service: { mode: 'warn' }
          }
        }
      },
      profiles: [
        {
          name: 'mgmt-zone',
          priority: 100,
          match: { 'tags.zone': 'mgmt' },
          override: {
            firewall: { allow_rules: { any_service: { mode: 'disabled' } } }
          }
        }
      ]
    },
    { tags: { zone: 'mgmt' } }
  );

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
  assert.equal(result.violations.length, 0);
  assert.ok(Array.isArray(result.selection?.matched_profiles));
  assert.equal(result.selection.matched_profiles.length, 1);
});

test('service_id is not treated as ANY', async () => {
  const policy = createPolicyEngine(
    {
      default: {
        mode: 'enforce',
        firewall: {
          allow_rules: {
            any_service: { mode: 'enforce', min_prefixlen: 16, require_explicit: true },
            unknown_service: { mode: 'enforce' }
          }
        }
      }
    },
    { tags: { environment: 'prod' } }
  );

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
              name: 'named-service',
              action: 'allow',
              source: [{ cidr: '10.10.0.0/24' }],
              destination: [{ cidr: '10.20.0.0/24' }],
              services: [{ service_id: 'postgres' }]
            }
          }
        }
      ]
    }
  });

  assert.equal(result.decision, 'allow');
  assert.equal(result.violations.length, 0);
});

test('unknown service entries can be denied', async () => {
  const policy = createPolicyEngine(
    {
      default: {
        mode: 'enforce',
        firewall: {
          allow_rules: {
            any_service: { mode: 'disabled' },
            unknown_service: { mode: 'enforce' }
          }
        }
      }
    },
    { tags: { environment: 'prod' } }
  );

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
              name: 'ambiguous-service',
              action: 'allow',
              source: [{ cidr: '10.10.0.0/24' }],
              destination: [{ cidr: '10.20.0.0/24' }],
              services: [{}]
            }
          }
        }
      ]
    }
  });

  assert.equal(result.decision, 'deny');
  assert.ok(result.violations.some(v => v.id === 'firewall-service-unknown'));
});
