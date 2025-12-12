import { randomUUID } from 'crypto';
import { performance } from 'perf_hooks';
import type { XCFGEnvelope } from './envelope.js';
import type { ExecutionPlan, ExecutionTask, TaskResult, TaskStatus } from './plan.js';
import type { AuditSink } from './audit.js';
import { Registry } from './registry.js';
import type { Telemetry } from './telemetry.js';
import { NoopTelemetry } from './telemetry.js';

export type RequestStatus = 'planned' | 'queued' | 'running' | 'executed' | 'failed';

export interface HandleOptions {
  request_id?: string;
  execute?: boolean;
}

export interface HandleResult {
  request_id: string;
  plan: ExecutionPlan;
  results?: TaskResult[];
  status: RequestStatus;
}

export class XCFGEngine {
  constructor(
    private registry: Registry,
    private audit: AuditSink,
    private telemetry: Telemetry = NoopTelemetry
  ) {}

  getAdapter(name: string) {
    return this.registry.getAdapter(name);
  }

  async executePlan(
    request_id: string,
    envelope: XCFGEnvelope,
    plan: ExecutionPlan
  ): Promise<{ results: TaskResult[]; status: RequestStatus }> {
    const span = this.telemetry.tracer.startSpan('xcfg.execute_plan', {
      request_id,
      type: envelope.type,
      type_version: envelope.type_version,
      operation: envelope.operation
    });
    const start = performance.now();

    const results: TaskResult[] = [];
    const orderedTasks = this.topoSortTasks(plan.tasks);
    for (const task of orderedTasks) {
      const taskSpan = this.telemetry.tracer.startSpan('xcfg.task.execute', {
        request_id,
        task_id: task.id,
        backend: task.backend,
        action: task.action
      });
      const taskStart = performance.now();
      let taskOutcome: TaskStatus = 'failed';
      this.telemetry.metrics.incCounter('xcfg_tasks_total', 1, {
        backend: task.backend,
        action: task.action
      });

      const adapter = this.registry.getAdapter(task.backend);
      if (!adapter) {
        const message = `No adapter registered for backend ${task.backend}`;
        await this.audit.write({
          request_id,
          timestamp: new Date().toISOString(),
          level: 'error',
          stage: 'execute',
          message,
          data: task
        });
        results.push({
          task_id: task.id,
          backend: task.backend,
          status: 'failed',
          error: { message }
        });
        this.telemetry.metrics.incCounter('xcfg_tasks_failed_total', 1, {
          backend: task.backend,
          reason: 'no_adapter'
        });
        this.telemetry.metrics.observeHistogram(
          'xcfg_task_duration_ms',
          performance.now() - taskStart,
          {
            backend: task.backend,
            action: task.action,
            status: 'failed'
          }
        );
        taskSpan.end('error');
        continue;
      }

      await this.audit.write({
        request_id,
        timestamp: new Date().toISOString(),
        level: 'info',
        stage: 'execute',
        message: `Executing task ${task.id} via ${adapter.name}`,
        data: task
      });

      try {
        const result = await adapter.execute(task, { request_id, task });
        taskOutcome = result.status;
        results.push(result);
        await this.audit.write({
          request_id,
          timestamp: new Date().toISOString(),
          level: 'info',
          stage: 'execute',
          message: `Task ${task.id} completed`,
          data: result
        });
        if (result.status === 'failed') {
          this.telemetry.metrics.incCounter('xcfg_tasks_failed_total', 1, {
            backend: task.backend,
            reason: 'adapter_failed'
          });
          taskSpan.end('error');
        } else {
          taskSpan.end('ok');
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : String(err);
        taskOutcome = 'failed';
        results.push({
          task_id: task.id,
          backend: task.backend,
          status: 'failed',
          error: { message: errorMessage }
        });
        await this.audit.write({
          request_id,
          timestamp: new Date().toISOString(),
          level: 'error',
          stage: 'execute',
          message: `Task ${task.id} failed`,
          data: { error: errorMessage }
        });
        this.telemetry.metrics.incCounter('xcfg_tasks_failed_total', 1, {
          backend: task.backend,
          reason: 'exception'
        });
        taskSpan.recordException(err);
        taskSpan.end('error');
      } finally {
        this.telemetry.metrics.observeHistogram(
          'xcfg_task_duration_ms',
          performance.now() - taskStart,
          {
            backend: task.backend,
            action: task.action,
            status: taskOutcome
          }
        );
      }
    }

    const status = this.rollupStatus(plan, results);
    this.telemetry.metrics.observeHistogram(
      'xcfg_execution_duration_ms',
      performance.now() - start,
      {
        type: envelope.type,
        operation: envelope.operation,
        status
      }
    );
    span.end(status === 'failed' ? 'error' : 'ok');
    return { results, status };
  }

  async handle(
    envelope: XCFGEnvelope,
    opts: HandleOptions = {}
  ): Promise<HandleResult> {
    const request_id = opts.request_id ?? randomUUID();
    const executeNow =
      opts.execute ?? (envelope.operation === 'apply');
    const requestSpan = this.telemetry.tracer.startSpan('xcfg.handle', {
      request_id,
      type: envelope.type,
      type_version: envelope.type_version,
      operation: envelope.operation
    });
    const requestStart = performance.now();
    this.telemetry.metrics.incCounter('xcfg_requests_total', 1, {
      type: envelope.type,
      operation: envelope.operation
    });

    try {
      await this.audit.write({
        request_id,
        timestamp: new Date().toISOString(),
        level: 'info',
        stage: 'receive',
        message: 'Received request',
        data: envelope
      });

      const translator = this.registry.getTranslator(
        envelope.type,
        envelope.type_version
      );
      if (!translator) {
        const message = `No translator registered for type ${envelope.type}@${envelope.type_version}`;
        await this.audit.write({
          request_id,
          timestamp: new Date().toISOString(),
          level: 'error',
          stage: 'translate',
          message
        });
        this.telemetry.metrics.incCounter('xcfg_requests_failed_total', 1, {
          type: envelope.type,
          reason: 'no_translator'
        });
        throw new Error(message);
      }

      if (translator.validate) {
        try {
          await translator.validate(
            { request_id, envelope },
            envelope.payload as any
          );
          await this.audit.write({
            request_id,
            timestamp: new Date().toISOString(),
            level: 'info',
            stage: 'validate',
            message: 'Payload validated'
          });
        } catch (err) {
          const errorMessage =
            err instanceof Error ? err.message : String(err);
          await this.audit.write({
            request_id,
            timestamp: new Date().toISOString(),
            level: 'error',
            stage: 'validate',
            message: 'Payload validation failed',
            data: { error: errorMessage }
          });
          this.telemetry.metrics.incCounter('xcfg_requests_failed_total', 1, {
            type: envelope.type,
            reason: 'validation'
          });
          throw new Error(`Validation failed: ${errorMessage}`);
        }
      }

      const plan = await translator.translate(
        { request_id, envelope },
        envelope.payload
      );
      await this.audit.write({
        request_id,
        timestamp: new Date().toISOString(),
        level: 'info',
        stage: 'translate',
        message: 'Produced execution plan',
        data: plan
      });

      if (!executeNow) {
        const status: RequestStatus =
          envelope.operation === 'apply' ? 'queued' : 'planned';
        this.telemetry.metrics.observeHistogram(
          'xcfg_request_duration_ms',
          performance.now() - requestStart,
          {
            type: envelope.type,
            operation: envelope.operation,
            status
          }
        );
        requestSpan.end('ok');
        return { request_id, plan, status };
      }

      const { results, status } = await this.executePlan(
        request_id,
        envelope,
        plan
      );
      this.telemetry.metrics.observeHistogram(
        'xcfg_request_duration_ms',
        performance.now() - requestStart,
        {
          type: envelope.type,
          operation: envelope.operation,
          status
        }
      );
      if (status === 'failed') {
        this.telemetry.metrics.incCounter('xcfg_requests_failed_total', 1, {
          type: envelope.type,
          operation: envelope.operation
        });
        requestSpan.end('error');
      } else {
        requestSpan.end('ok');
      }
      return { request_id, plan, results, status };
    } catch (err) {
      this.telemetry.metrics.incCounter('xcfg_requests_failed_total', 1, {
        type: envelope.type,
        operation: envelope.operation
      });
      this.telemetry.metrics.observeHistogram(
        'xcfg_request_duration_ms',
        performance.now() - requestStart,
        {
          type: envelope.type,
          operation: envelope.operation,
          status: 'error'
        }
      );
      requestSpan.recordException(err);
      requestSpan.end('error');
      throw err;
    }
  }

  private rollupStatus(plan: ExecutionPlan, results: TaskResult[]): RequestStatus {
    const hasFailed = results.some(r => r.status === 'failed');
    const allSucceeded =
      plan.tasks.length > 0 &&
      plan.tasks.every(
        t =>
          results.find(r => r.task_id === t.id)?.status ===
          'succeeded'
      );
    const anyRunning = results.some(
      r => r.status === 'running' || r.status === 'queued'
    );

    return hasFailed
      ? 'failed'
      : allSucceeded
        ? 'executed'
        : anyRunning
          ? 'running'
          : 'executed';
  }

  private topoSortTasks(tasks: ExecutionTask[]): ExecutionTask[] {
    if (tasks.length <= 1) return tasks;

    const byId = new Map<string, ExecutionTask>();
    for (const t of tasks) {
      byId.set(t.id, t);
    }

    const indegree = new Map<string, number>();
    const out = new Map<string, string[]>();

    for (const t of tasks) {
      indegree.set(t.id, 0);
      out.set(t.id, []);
    }

    for (const t of tasks) {
      const deps = t.depends_on ?? [];
      for (const dep of deps) {
        if (!byId.has(dep)) {
          throw new Error(
            `Task ${t.id} depends on missing task ${dep}`
          );
        }
        indegree.set(t.id, (indegree.get(t.id) ?? 0) + 1);
        out.get(dep)!.push(t.id);
      }
    }

    const queue: string[] = [];
    for (const [id, deg] of indegree.entries()) {
      if (deg === 0) queue.push(id);
    }

    const ordered: ExecutionTask[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const task = byId.get(id);
      if (task) ordered.push(task);
      for (const next of out.get(id) ?? []) {
        indegree.set(next, (indegree.get(next) ?? 0) - 1);
        if (indegree.get(next) === 0) queue.push(next);
      }
    }

    if (ordered.length !== tasks.length) {
      throw new Error('Execution plan contains a dependency cycle');
    }

    return ordered;
  }
}
