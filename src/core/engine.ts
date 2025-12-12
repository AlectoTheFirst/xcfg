import { randomUUID } from 'crypto';
import { performance } from 'perf_hooks';
import type { UCEEnvelope } from './envelope.js';
import type { ExecutionPlan, TaskResult, TaskStatus } from './plan.js';
import type { AuditSink } from './audit.js';
import { Registry } from './registry.js';
import type { Telemetry } from './telemetry.js';
import { NoopTelemetry } from './telemetry.js';

export type RequestStatus = 'planned' | 'executed' | 'failed';

export interface HandleResult {
  request_id: string;
  plan: ExecutionPlan;
  results?: TaskResult[];
  status: RequestStatus;
}

export class UCEEngine {
  constructor(
    private registry: Registry,
    private audit: AuditSink,
    private telemetry: Telemetry = NoopTelemetry
  ) {}

  async handle(envelope: UCEEnvelope): Promise<HandleResult> {
    const request_id = randomUUID();
    const requestSpan = this.telemetry.tracer.startSpan('uce.handle', {
      request_id,
      type: envelope.type,
      type_version: envelope.type_version,
      operation: envelope.operation
    });
    const requestStart = performance.now();
    this.telemetry.metrics.incCounter('uce_requests_total', 1, {
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
      this.telemetry.metrics.incCounter('uce_requests_failed_total', 1, {
        type: envelope.type,
        reason: 'no_translator'
      });
      throw new Error(message);
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

    if (envelope.operation !== 'apply') {
      this.telemetry.metrics.observeHistogram(
        'uce_request_duration_ms',
        performance.now() - requestStart,
        {
          type: envelope.type,
          operation: envelope.operation,
          status: 'planned'
        }
      );
      requestSpan.end('ok');
      return { request_id, plan, status: 'planned' };
    }

    const results: TaskResult[] = [];
    for (const task of plan.tasks) {
      const taskSpan = this.telemetry.tracer.startSpan('uce.task.execute', {
        request_id,
        task_id: task.id,
        backend: task.backend,
        action: task.action
      });
      const taskStart = performance.now();
      let taskOutcome: TaskStatus = 'failed';
      this.telemetry.metrics.incCounter('uce_tasks_total', 1, {
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
        this.telemetry.metrics.incCounter('uce_tasks_failed_total', 1, {
          backend: task.backend,
          reason: 'no_adapter'
        });
        this.telemetry.metrics.observeHistogram(
          'uce_task_duration_ms',
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
          this.telemetry.metrics.incCounter('uce_tasks_failed_total', 1, {
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
        this.telemetry.metrics.incCounter('uce_tasks_failed_total', 1, {
          backend: task.backend,
          reason: 'exception'
        });
        taskSpan.recordException(err);
        taskSpan.end('error');
      } finally {
        this.telemetry.metrics.observeHistogram(
          'uce_task_duration_ms',
          performance.now() - taskStart,
          {
            backend: task.backend,
            action: task.action,
            status: taskOutcome
          }
        );
      }
    }

    const status = results.some(r => r.status === 'failed')
      ? 'failed'
      : 'executed';
    this.telemetry.metrics.observeHistogram(
      'uce_request_duration_ms',
      performance.now() - requestStart,
      {
        type: envelope.type,
        operation: envelope.operation,
        status
      }
    );
    if (status === 'failed') {
      this.telemetry.metrics.incCounter('uce_requests_failed_total', 1, {
        type: envelope.type,
        operation: envelope.operation
      });
      requestSpan.end('error');
    } else {
      requestSpan.end('ok');
    }
    return { request_id, plan, results, status };
    } catch (err) {
      this.telemetry.metrics.incCounter('uce_requests_failed_total', 1, {
        type: envelope.type,
        operation: envelope.operation
      });
      this.telemetry.metrics.observeHistogram(
        'uce_request_duration_ms',
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
}
