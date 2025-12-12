import { randomUUID } from 'crypto';
import type { BackendAdapter, AdapterContext } from '../../core/adapter.js';
import type { ExecutionTask, TaskResult, TaskStatus } from '../../core/plan.js';

type JobState = { startedAt: number; durationMs: number };
const jobs = new Map<string, JobState>();

export const mockAsyncAdapter: BackendAdapter = {
  name: 'mock-async',

  async execute(
    task: ExecutionTask,
    _ctx: AdapterContext
  ): Promise<TaskResult> {
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

  async checkStatus(
    external_id: string,
    _ctx: AdapterContext
  ): Promise<TaskStatus> {
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
