import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveBackendConfig,
  resolveBackendSecrets
} from '../src/core/backendConfig.js';

test('backend config can be pinned to metadata via profiles', () => {
  const backendsConfig = {
    backends: {
      checkpoint: { base_url: 'https://a.example', domain: 'mds1' }
    },
    profiles: [
      {
        name: 'prod-untrust',
        priority: 100,
        match: { environment: 'prod', backend: 'checkpoint', 'tags.zone': 'untrust' },
        override: {
          backends: {
            checkpoint: { domain: 'mds-prod', policy_package: 'corp-prod' }
          }
        }
      }
    ]
  };

  const envelope = { tags: { environment: 'prod', zone: 'untrust' } };
  const plan = { tasks: [{ id: 't1', backend: 'checkpoint', action: 'firewall.rule.add' }] };
  const task = { id: 't1', backend: 'checkpoint' };

  const resolved = resolveBackendConfig(backendsConfig, envelope, plan, task);
  assert.equal(resolved.backend, 'checkpoint');
  assert.equal(resolved.environment, 'prod');
  assert.equal(resolved.config.base_url, 'https://a.example');
  assert.equal(resolved.config.domain, 'mds-prod');
  assert.equal(resolved.config.policy_package, 'corp-prod');
  assert.deepEqual(resolved.matched_profiles, [{ name: 'prod-untrust', priority: 100 }]);
});

test('backend secrets are selected by backend name', () => {
  const secretsConfig = { backends: { checkpoint: { token: 'secret' } } };
  const resolved = resolveBackendSecrets(secretsConfig, { backend: 'checkpoint' });
  assert.equal(resolved.backend, 'checkpoint');
  assert.deepEqual(resolved.secrets, { token: 'secret' });
});

