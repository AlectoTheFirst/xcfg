import test from 'node:test';
import assert from 'node:assert/strict';

import { Registry } from '../src/core/registry.js';
import { XCFGEngine } from '../src/core/engine.js';
import { InMemoryAuditSink } from '../src/core/audit.js';
import { NoopTelemetry } from '../src/core/telemetry.js';

test('executePlan respects depends_on for async tasks', async () => {
  /** @type {string[]} */
  const calls = [];

  const adapter = {
    name: 'test',
    async execute(task) {
      calls.push(task.action);
      if (task.action === 'a') {
        return {
          task_id: task.id,
          backend: task.backend,
          status: 'running',
          external_id: 'job-a'
        };
      }
      return {
        task_id: task.id,
        backend: task.backend,
        status: 'succeeded'
      };
    }
  };

  const registry = new Registry();
  registry.registerAdapter(adapter);

  const engine = new XCFGEngine(registry, new InMemoryAuditSink(), NoopTelemetry);

  const envelope = { type: 't', type_version: '1', operation: 'apply' };
  const plan = {
    tasks: [
      { id: 'A', backend: 'test', action: 'a' },
      { id: 'B', backend: 'test', action: 'b', depends_on: ['A'] }
    ]
  };

  const first = await engine.executePlan('req-1', envelope, plan);
  assert.deepEqual(calls, ['a']);
  assert.equal(first.results.find(r => r.task_id === 'A')?.status, 'running');
  assert.equal(first.results.find(r => r.task_id === 'B')?.status, 'queued');

  const now = new Date().toISOString();
  const secondResults = first.results.map(r =>
    r.task_id === 'A' ? { ...r, status: 'succeeded', finished_at: now } : r
  );

  const second = await engine.executePlan('req-1', envelope, plan, secondResults);
  assert.deepEqual(calls, ['a', 'b']);
  assert.equal(second.results.find(r => r.task_id === 'B')?.status, 'succeeded');
});

