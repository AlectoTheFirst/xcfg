import type { ExecutionTask, TaskResult, TaskStatus } from './plan.js';

export interface AdapterContext {
  request_id: string;
  task: ExecutionTask;
  secrets?: Record<string, string>;
  state?: Record<string, unknown>;
}

export interface BackendAdapter {
  name: string;
  execute(task: ExecutionTask, ctx: AdapterContext): Promise<TaskResult>;
  checkStatus?(external_id: string, ctx: AdapterContext): Promise<TaskStatus>;
  handleCallback?(payload: unknown, ctx: AdapterContext): Promise<void>;
}

