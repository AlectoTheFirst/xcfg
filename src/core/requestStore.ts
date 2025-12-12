import type { XCFGEnvelope } from './envelope.js';
import type { ExecutionPlan, TaskResult } from './plan.js';
import type { RequestStatus } from './engine.js';

export interface RequestRecord {
  request_id: string;
  envelope: XCFGEnvelope;
  plan?: ExecutionPlan;
  results?: TaskResult[];
  status: RequestStatus;
  created_at: string;
  updated_at: string;
}

export interface TaskExternalRef {
  request_id: string;
  task_id: string;
  backend: string;
  external_id: string;
}

export interface RequestStore {
  create(record: RequestRecord): Promise<void>;
  update(
    request_id: string,
    patch: Partial<Omit<RequestRecord, 'request_id' | 'created_at'>>
  ): Promise<void>;
  get(request_id: string): Promise<RequestRecord | undefined>;
  findByIdempotencyKey(
    idempotency_key: string
  ): Promise<RequestRecord | undefined>;
  listByStatus(
    statuses: RequestStatus[],
    limit?: number
  ): Promise<RequestRecord[]>;
  findTaskByExternalId(
    backend: string,
    external_id: string
  ): Promise<TaskExternalRef | undefined>;
}

export class InMemoryRequestStore implements RequestStore {
  private records = new Map<string, RequestRecord>();
  private externalRefs = new Map<string, TaskExternalRef>();
  private byIdempotencyKey = new Map<string, string>();

  private makeExternalKey(backend: string, external_id: string): string {
    return `${backend}:${external_id}`;
  }

  private reindexExternalRefs(
    request_id: string,
    results?: TaskResult[]
  ): void {
    for (const [key, ref] of this.externalRefs.entries()) {
      if (ref.request_id === request_id) this.externalRefs.delete(key);
    }
    if (!results) return;
    for (const r of results) {
      if (!r.external_id) continue;
      const ref: TaskExternalRef = {
        request_id,
        task_id: r.task_id,
        backend: r.backend,
        external_id: r.external_id
      };
      this.externalRefs.set(
        this.makeExternalKey(r.backend, r.external_id),
        ref
      );
    }
  }

  async create(record: RequestRecord): Promise<void> {
    this.records.set(record.request_id, record);
    this.byIdempotencyKey.set(record.envelope.idempotency_key, record.request_id);
    this.reindexExternalRefs(record.request_id, record.results);
  }

  async update(
    request_id: string,
    patch: Partial<Omit<RequestRecord, 'request_id' | 'created_at'>>
  ): Promise<void> {
    const existing = this.records.get(request_id);
    if (!existing) return;
    const updated: RequestRecord = {
      ...existing,
      ...patch,
      updated_at: new Date().toISOString()
    };
    this.records.set(request_id, updated);
    if (patch.envelope?.idempotency_key) {
      this.byIdempotencyKey.set(patch.envelope.idempotency_key, request_id);
    }
    if (patch.results) {
      this.reindexExternalRefs(request_id, patch.results);
    }
  }

  async get(request_id: string): Promise<RequestRecord | undefined> {
    return this.records.get(request_id);
  }

  async findByIdempotencyKey(
    idempotency_key: string
  ): Promise<RequestRecord | undefined> {
    const request_id = this.byIdempotencyKey.get(idempotency_key);
    if (!request_id) return undefined;
    return this.records.get(request_id);
  }

  async listByStatus(
    statuses: RequestStatus[],
    limit = 100
  ): Promise<RequestRecord[]> {
    const allowed = new Set(statuses);
    const results: RequestRecord[] = [];
    for (const record of this.records.values()) {
      if (!allowed.has(record.status)) continue;
      results.push(record);
      if (results.length >= limit) break;
    }
    results.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return results;
  }

  async findTaskByExternalId(
    backend: string,
    external_id: string
  ): Promise<TaskExternalRef | undefined> {
    return this.externalRefs.get(this.makeExternalKey(backend, external_id));
  }
}
