import type { XCFGEngine, RequestStatus } from './engine.js';
import type {
  RequestRecord,
  RequestStore
} from './requestStore.js';
import type { ExecutionTask, TaskResult, TaskStatus } from './plan.js';

export interface RunnerOptions {
  pollIntervalMs?: number;
  maxBatchSize?: number;
}

export class InProcessRunner {
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    private engine: XCFGEngine,
    private store: RequestStore,
    private opts: RunnerOptions = {}
  ) {}

  start(): void {
    if (this.timer) return;
    const interval = this.opts.pollIntervalMs ?? 1000;
    this.timer = setInterval(() => {
      void this.tick();
    }, interval);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async enqueue(_request_id: string): Promise<void> {
    // Runner is polling-based for the POC.
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.processQueued();
      await this.processRunning();
    } finally {
      this.busy = false;
    }
  }

  private async processQueued(): Promise<void> {
    const queued = await this.store.listByStatus(['queued'], this.opts.maxBatchSize ?? 5);
    for (const record of queued) {
      await this.store.update(record.request_id, { status: 'running' });
      const handleResult = await this.engine.handle(record.envelope, {
        request_id: record.request_id,
        execute: true
      });
      const status = rollupRequestStatus(handleResult.plan, handleResult.results);
      await this.store.update(record.request_id, {
        plan: handleResult.plan,
        results: handleResult.results,
        status
      });
    }
  }

  private async processRunning(): Promise<void> {
    const running = await this.store.listByStatus(['running'], this.opts.maxBatchSize ?? 50);
    for (const record of running) {
      if (!record.plan || !record.results) continue;
      const updatedResults: TaskResult[] = [...record.results];
      let changed = false;
      for (let i = 0; i < updatedResults.length; i++) {
        const r = updatedResults[i];
        if (r.status !== 'running' || !r.external_id) continue;
        const adapter = this.engine.getAdapter(r.backend);
        if (!adapter?.checkStatus) continue;
        const task = record.plan.tasks.find(t => t.id === r.task_id);
        if (!task) continue;
        try {
          const newStatus = await adapter.checkStatus(r.external_id, {
            request_id: record.request_id,
            task
          });
          if (newStatus !== r.status) {
            updatedResults[i] = {
              ...r,
              status: newStatus,
              finished_at:
                newStatus === 'succeeded' || newStatus === 'failed'
                  ? new Date().toISOString()
                  : r.finished_at
            };
            changed = true;
          }
        } catch {
          // If polling fails, leave task running for next tick.
        }
      }

      if (!changed) continue;
      const status = rollupRequestStatus(record.plan, updatedResults);
      await this.store.update(record.request_id, {
        results: updatedResults,
        status
      });
    }
  }
}

function rollupRequestStatus(
  plan: { tasks: ExecutionTask[] },
  results?: TaskResult[]
): RequestStatus {
  const taskResults = results ?? [];
  if (taskResults.some(r => r.status === 'failed')) return 'failed';
  if (
    plan.tasks.length > 0 &&
    plan.tasks.every(
      t =>
        taskResults.find(r => r.task_id === t.id)?.status ===
        'succeeded'
    )
  ) {
    return 'executed';
  }
  if (taskResults.some(r => r.status === 'running' || r.status === 'queued')) {
    return 'running';
  }
  return 'executed';
}

