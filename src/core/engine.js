import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { NoopTelemetry } from './telemetry.js';

export class XCFGEngine {
  constructor(registry, audit, telemetry = NoopTelemetry, contextProvider) {
    this.registry = registry;
    this.audit = audit;
    this.telemetry = telemetry;
    this.contextProvider = contextProvider;
  }

  getAdapter(name) {
    return this.registry.getAdapter(name);
  }

  async buildAdapterContext(request_id, envelope, plan, task) {
    const base = { request_id, task };
    if (!this.contextProvider) return base;
    try {
      const extra = await this.contextProvider({ request_id, envelope, plan, task });
      if (!extra || typeof extra !== 'object') return base;
      return { ...base, ...extra };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.audit.write({
        request_id,
        timestamp: new Date().toISOString(),
        level: 'error',
        stage: 'execute',
        message: 'Adapter context provider failed',
        data: { error: errorMessage, backend: task?.backend, task_id: task?.id }
      });
      return base;
    }
  }

  async executePlan(request_id, envelope, plan, existingResults = []) {
    const orderedTasks = this.topoSortTasks(plan.tasks ?? []);
    const resultByTaskId = seedTaskResults(orderedTasks, existingResults);

    const cancellationEvents = cancelBlockedTasks(
      orderedTasks,
      resultByTaskId,
      new Date().toISOString()
    );
    for (const event of cancellationEvents) {
      await this.audit.write({ request_id, ...event });
    }

    if (listRunnableTasks(orderedTasks, resultByTaskId).length === 0) {
      const results = orderedResults(orderedTasks, resultByTaskId);
      const status = this.rollupStatus(plan, results);
      return { results, status };
    }

    const span = this.telemetry.tracer.startSpan('xcfg.execute_plan', {
      request_id,
      type: envelope.type,
      type_version: envelope.type_version,
      operation: envelope.operation
    });
    const start = performance.now();

    while (true) {
      const runnable = listRunnableTasks(orderedTasks, resultByTaskId);
      if (runnable.length === 0) break;

      for (const task of runnable) {
        const taskSpan = this.telemetry.tracer.startSpan('xcfg.task.execute', {
          request_id,
          task_id: task.id,
          backend: task.backend,
          action: task.action
        });
        const taskStart = performance.now();
        let taskOutcome = 'failed';
        this.telemetry.metrics.incCounter('xcfg_tasks_total', 1, {
          backend: task.backend,
          action: task.action
        });

        const adapter = this.registry.getAdapter(task.backend);
        if (!adapter) {
          const message = `No adapter registered for backend ${task.backend}`;
          upsertResult(resultByTaskId, task.id, {
            task_id: task.id,
            backend: task.backend,
            status: 'failed',
            error: { message },
            finished_at: new Date().toISOString()
          });
          await this.audit.write({
            request_id,
            timestamp: new Date().toISOString(),
            level: 'error',
            stage: 'execute',
            message,
            data: task
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
          const now = new Date().toISOString();
          const ctx = await this.buildAdapterContext(request_id, envelope, plan, task);
          const result = await adapter.execute(task, ctx);
          taskOutcome = result.status;

          const finished_at =
            result.status === 'succeeded' || result.status === 'failed'
              ? result.finished_at ?? now
              : result.finished_at;
          upsertResult(resultByTaskId, task.id, {
            ...result,
            task_id: task.id,
            backend: task.backend,
            started_at: result.started_at ?? now,
            finished_at
          });

          const resultMessage =
            result.status === 'running' || result.status === 'queued'
              ? `Task ${task.id} accepted (${result.status})`
              : `Task ${task.id} finished (${result.status})`;
          await this.audit.write({
            request_id,
            timestamp: new Date().toISOString(),
            level: 'info',
            stage: 'execute',
            message: resultMessage,
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
          const errorMessage = err instanceof Error ? err.message : String(err);
          taskOutcome = 'failed';
          upsertResult(resultByTaskId, task.id, {
            task_id: task.id,
            backend: task.backend,
            status: 'failed',
            error: { message: errorMessage },
            finished_at: new Date().toISOString()
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

        const results = orderedResults(orderedTasks, resultByTaskId);
        const status = this.rollupStatus(plan, results);
        if (status === 'failed') break;
      }

      const status = this.rollupStatus(
        plan,
        orderedResults(orderedTasks, resultByTaskId)
      );
      if (status === 'failed') break;
    }

    const results = orderedResults(orderedTasks, resultByTaskId);
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

  async handle(envelope, opts = {}) {
    const request_id = opts.request_id ?? randomUUID();
    const executeNow = opts.execute ?? envelope.operation === 'apply';

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
          await translator.validate({ request_id, envelope }, envelope.payload);
          await this.audit.write({
            request_id,
            timestamp: new Date().toISOString(),
            level: 'info',
            stage: 'validate',
            message: 'Payload validated'
          });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
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
        const status = envelope.operation === 'apply' ? 'queued' : 'planned';
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

      const { results, status } = await this.executePlan(request_id, envelope, plan);
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

  rollupStatus(plan, results) {
    const hasFailed = results.some(
      r => r.status === 'failed' || r.status === 'canceled'
    );
    const allSucceeded =
      (plan.tasks ?? []).length > 0 &&
      (plan.tasks ?? []).every(
        t => results.find(r => r.task_id === t.id)?.status === 'succeeded'
      );
    const anyRunning = (plan.tasks ?? []).some(task => {
      const result = results.find(r => r.task_id === task.id);
      return !result || result.status === 'running' || result.status === 'queued';
    });

    return hasFailed
      ? 'failed'
      : allSucceeded
        ? 'executed'
        : anyRunning
          ? 'running'
          : 'executed';
  }

  topoSortTasks(tasks) {
    if (tasks.length <= 1) return tasks;

    const byId = new Map();
    for (const t of tasks) byId.set(t.id, t);

    const indegree = new Map();
    const out = new Map();
    for (const t of tasks) {
      indegree.set(t.id, 0);
      out.set(t.id, []);
    }

    for (const t of tasks) {
      const deps = t.depends_on ?? [];
      for (const dep of deps) {
        if (!byId.has(dep)) {
          throw new Error(`Task ${t.id} depends on missing task ${dep}`);
        }
        indegree.set(t.id, (indegree.get(t.id) ?? 0) + 1);
        out.get(dep).push(t.id);
      }
    }

    const queue = [];
    for (const [id, deg] of indegree.entries()) {
      if (deg === 0) queue.push(id);
    }

    const ordered = [];
    while (queue.length > 0) {
      const id = queue.shift();
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

function seedTaskResults(tasks, existingResults) {
  const taskIds = new Set(tasks.map(t => t.id));
  const map = new Map();

  for (const r of existingResults ?? []) {
    if (!r || typeof r !== 'object') continue;
    if (typeof r.task_id !== 'string') continue;
    if (!taskIds.has(r.task_id)) continue;
    map.set(r.task_id, r);
  }

  for (const task of tasks) {
    if (map.has(task.id)) continue;
    map.set(task.id, { task_id: task.id, backend: task.backend, status: 'queued' });
  }

  return map;
}

function cancelBlockedTasks(tasks, resultByTaskId, timestamp) {
  const events = [];
  for (const task of tasks) {
    const current = resultByTaskId.get(task.id);
    if (!current) continue;
    if (current.status !== 'queued') continue;
    if (current.started_at) continue;

    const failedDep = (task.depends_on ?? []).find(dep => {
      const depResult = resultByTaskId.get(dep);
      return (
        depResult && (depResult.status === 'failed' || depResult.status === 'canceled')
      );
    });
    if (!failedDep) continue;

    const message = `Task ${task.id} canceled due to failed dependency ${failedDep}`;
    resultByTaskId.set(task.id, {
      ...current,
      status: 'canceled',
      error: { message },
      started_at: current.started_at ?? timestamp,
      finished_at: timestamp
    });
    events.push({
      timestamp,
      level: 'warn',
      stage: 'execute',
      message,
      data: { task_id: task.id, depends_on: task.depends_on }
    });
  }
  return events;
}

function listRunnableTasks(tasks, resultByTaskId) {
  const runnable = [];
  for (const task of tasks) {
    const current = resultByTaskId.get(task.id);
    if (!current) {
      runnable.push(task);
      continue;
    }
    if (current.status !== 'queued') continue;
    if (current.started_at) continue;
    if (!dependenciesSucceeded(task, resultByTaskId)) continue;
    runnable.push(task);
  }
  return runnable;
}

function dependenciesSucceeded(task, resultByTaskId) {
  for (const dep of task.depends_on ?? []) {
    const depResult = resultByTaskId.get(dep);
    if (!depResult || depResult.status !== 'succeeded') return false;
  }
  return true;
}

function upsertResult(resultByTaskId, taskId, patch) {
  const existing = resultByTaskId.get(taskId) ?? { task_id: taskId };
  resultByTaskId.set(taskId, { ...existing, ...patch });
}

function orderedResults(tasks, resultByTaskId) {
  const results = [];
  for (const task of tasks) {
    const r = resultByTaskId.get(task.id);
    if (r) results.push(r);
  }
  return results;
}
