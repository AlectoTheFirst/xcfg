export class InProcessRunner {
  constructor(engine, store, opts = {}) {
    this.engine = engine;
    this.store = store;
    this.opts = opts;

    this.timer = undefined;
    this.busy = false;
  }

  start() {
    if (this.timer) return;
    const interval = this.opts.pollIntervalMs ?? 1000;
    this.timer = setInterval(() => {
      void this.tick();
    }, interval);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async enqueue(_request_id) {
    // Runner is polling-based for the POC.
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      try {
        await this.processQueued();
      } catch (err) {
        console.error('[runner] processQueued failed', err);
      }
      try {
        await this.processRunning();
      } catch (err) {
        console.error('[runner] processRunning failed', err);
      }
    } finally {
      this.busy = false;
    }
  }

  async processQueued() {
    const queued = await this.store.listByStatus(
      ['queued'],
      this.opts.maxBatchSize ?? 5
    );
    for (const record of queued) {
      try {
        const plan =
          record.plan ??
          (await this.engine.handle(record.envelope, {
            request_id: record.request_id,
            execute: false
          })).plan;

        const seededResults =
          record.results ??
          (plan.tasks ?? []).map(t => ({
            task_id: t.id,
            backend: t.backend,
            status: 'queued'
          }));

        await this.store.update(record.request_id, {
          status: 'running',
          plan,
          results: seededResults
        });

        const { results, status } = await this.engine.executePlan(
          record.request_id,
          record.envelope,
          plan,
          seededResults
        );

        await this.store.update(record.request_id, { plan, results, status });
      } catch (err) {
        console.error('[runner] request execution failed', {
          request_id: record.request_id,
          error: err
        });
        await this.store.update(record.request_id, { status: 'failed' });
      }
    }
  }

  async processRunning() {
    const running = await this.store.listByStatus(
      ['running'],
      this.opts.maxBatchSize ?? 50
    );
    for (const record of running) {
      try {
        if (!record.plan) continue;
        const baseResults =
          record.results ??
          (record.plan.tasks ?? []).map(t => ({
            task_id: t.id,
            backend: t.backend,
            status: 'queued'
          }));
        const updatedResults = [...baseResults];
        let changed = false;
        for (let i = 0; i < updatedResults.length; i++) {
          const r = updatedResults[i];
          if (!r.external_id) continue;
          if (r.status !== 'running' && r.status !== 'queued') continue;
          const adapter = this.engine.getAdapter(r.backend);
          if (!adapter?.checkStatus) continue;
          const task = record.plan.tasks.find(t => t.id === r.task_id);
          if (!task) continue;
          try {
            const ctx = await this.engine.buildAdapterContext(
              record.request_id,
              record.envelope,
              record.plan,
              task
            );
            const newStatus = await adapter.checkStatus(r.external_id, ctx);
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

        const before = fingerprintResults(baseResults);
        const afterPoll = fingerprintResults(updatedResults);

        const { results: progressedResults, status } = await this.engine.executePlan(
          record.request_id,
          record.envelope,
          record.plan,
          updatedResults
        );
        const afterExecute = fingerprintResults(progressedResults);

        if (!changed && before === afterPoll && before === afterExecute && status === record.status) {
          continue;
        }

        await this.store.update(record.request_id, { results: progressedResults, status });
      } catch (err) {
        console.error('[runner] request poll/update failed', {
          request_id: record.request_id,
          error: err
        });
      }
    }
  }
}

function rollupRequestStatus(plan, results = []) {
  if (results.some(r => r.status === 'failed')) return 'failed';
  if (
    (plan.tasks ?? []).length > 0 &&
    (plan.tasks ?? []).every(
      t => results.find(r => r.task_id === t.id)?.status === 'succeeded'
    )
  ) {
    return 'executed';
  }
  if (results.some(r => r.status === 'running' || r.status === 'queued')) {
    return 'running';
  }
  return 'executed';
}

function fingerprintResults(results) {
  const view = (results ?? [])
    .map(r => ({
      task_id: r.task_id,
      status: r.status,
      external_id: r.external_id,
      started_at: r.started_at,
      finished_at: r.finished_at
    }))
    .sort((a, b) => a.task_id.localeCompare(b.task_id));
  return JSON.stringify(view);
}
