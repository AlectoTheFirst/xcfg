import type { UCEEnvelope } from './envelope.js';
import type { ExecutionPlan, TaskResult } from './plan.js';
import type { RequestStatus } from './engine.js';

export interface RequestRecord {
  request_id: string;
  envelope: UCEEnvelope;
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
  findTaskByExternalId(
    backend: string,
    external_id: string
  ): Promise<TaskExternalRef | undefined>;
}

export class InMemoryRequestStore implements RequestStore {
  private records = new Map<string, RequestRecord>();
  private externalRefs = new Map<string, TaskExternalRef>();

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
    if (patch.results) {
      this.reindexExternalRefs(request_id, patch.results);
    }
  }

  async get(request_id: string): Promise<RequestRecord | undefined> {
    return this.records.get(request_id);
  }

  async findTaskByExternalId(
    backend: string,
    external_id: string
  ): Promise<TaskExternalRef | undefined> {
    return this.externalRefs.get(this.makeExternalKey(backend, external_id));
  }
}
