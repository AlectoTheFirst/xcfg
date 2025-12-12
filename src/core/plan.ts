export type TaskStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export interface ExecutionTask {
  id: string;
  backend: string;
  action: string;
  input: unknown;
  depends_on?: string[];
}

export interface ExecutionPlan {
  tasks: ExecutionTask[];
}

export interface TaskResult {
  task_id: string;
  backend: string;
  status: TaskStatus;
  external_id?: string;
  output?: unknown;
  error?: { message: string; details?: unknown };
  started_at?: string;
  finished_at?: string;
}

