import type { BackendAdapter, AdapterContext } from '../../core/adapter.js';
import type { ExecutionTask, TaskResult } from '../../core/plan.js';

export const checkpointAdapter: BackendAdapter = {
  name: 'checkpoint',
  async execute(
    task: ExecutionTask,
    _ctx: AdapterContext
  ): Promise<TaskResult> {
    const now = new Date().toISOString();
    return {
      task_id: task.id,
      backend: task.backend,
      status: 'succeeded',
      external_id: `stub-${task.id}`,
      output: {
        note: 'Checkpoint adapter is a scaffold',
        action: task.action
      },
      started_at: now,
      finished_at: now
    };
  }
};
