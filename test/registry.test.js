import test from 'node:test';
import assert from 'node:assert/strict';

import { Registry } from '../src/core/registry.js';

test('registry can list translators by type/version', () => {
  const registry = new Registry();
  registry.registerTranslator({ type: 'b', version: '2', translate() {} });
  registry.registerTranslator({ type: 'b', version: '1', translate() {} });
  registry.registerTranslator({ type: 'a', version: '1', translate() {} });

  assert.deepEqual(registry.listTranslators(), [
    { type: 'a', versions: ['1'] },
    { type: 'b', versions: ['1', '2'] }
  ]);
});

