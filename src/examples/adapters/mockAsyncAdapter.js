import { randomUUID } from 'node:crypto';

/** @type {Map<string, { startedAt: number, durationMs: number }>} */
const jobs = new Map();

export const mockAsyncAdapter = {
  name: 'mock-async',

  async execute(task, _ctx) {
    const external_id = randomUUID();
    jobs.set(external_id, {
      startedAt: Date.now(),
      durationMs: 3000
    });
    const now = new Date().toISOString();
    return {
      task_id: task.id,
      backend: task.backend,
      status: 'running',
      external_id,
      output: {
        note: 'Mock async job started',
        action: task.action
      },
      started_at: now
    };
  },

  async checkStatus(external_id, _ctx) {
    const job = jobs.get(external_id);
    if (!job) return 'failed';
    const elapsed = Date.now() - job.startedAt;
    if (elapsed >= job.durationMs) {
      jobs.delete(external_id);
      return 'succeeded';
    }
    return 'running';
  }
};

