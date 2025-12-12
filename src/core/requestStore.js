/**
 * @typedef {Object} TaskExternalRef
 * @property {string} request_id
 * @property {string} task_id
 * @property {string} backend
 * @property {string} external_id
 */

export class InMemoryRequestStore {
  constructor() {
    /** @type {Map<string, any>} */
    this.records = new Map();
    /** @type {Map<string, TaskExternalRef>} */
    this.externalRefs = new Map();
    /** @type {Map<string, string>} */
    this.byIdempotencyKey = new Map();
  }

  makeExternalKey(backend, external_id) {
    return `${backend}:${external_id}`;
  }

  reindexExternalRefs(request_id, results) {
    for (const [key, ref] of this.externalRefs.entries()) {
      if (ref.request_id === request_id) this.externalRefs.delete(key);
    }
    if (!results) return;
    for (const r of results) {
      if (!r.external_id) continue;
      const ref = {
        request_id,
        task_id: r.task_id,
        backend: r.backend,
        external_id: r.external_id
      };
      this.externalRefs.set(this.makeExternalKey(r.backend, r.external_id), ref);
    }
  }

  async create(record) {
    this.records.set(record.request_id, record);
    this.byIdempotencyKey.set(record.envelope.idempotency_key, record.request_id);
    this.reindexExternalRefs(record.request_id, record.results);
  }

  async update(request_id, patch) {
    const existing = this.records.get(request_id);
    if (!existing) return;
    const updated = {
      ...existing,
      ...patch,
      updated_at: new Date().toISOString()
    };
    this.records.set(request_id, updated);
    if (patch?.envelope?.idempotency_key) {
      this.byIdempotencyKey.set(patch.envelope.idempotency_key, request_id);
    }
    if (patch?.results) {
      this.reindexExternalRefs(request_id, patch.results);
    }
  }

  async get(request_id) {
    return this.records.get(request_id);
  }

  async findByIdempotencyKey(idempotency_key) {
    const request_id = this.byIdempotencyKey.get(idempotency_key);
    if (!request_id) return undefined;
    return this.records.get(request_id);
  }

  async listByStatus(statuses, limit = 100) {
    const allowed = new Set(statuses);
    const results = [];
    for (const record of this.records.values()) {
      if (!allowed.has(record.status)) continue;
      results.push(record);
      if (results.length >= limit) break;
    }
    results.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return results;
  }

  async findTaskByExternalId(backend, external_id) {
    return this.externalRefs.get(this.makeExternalKey(backend, external_id));
  }
}

