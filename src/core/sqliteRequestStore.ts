import { mkdirSync } from 'fs';
import { dirname } from 'path';
import Database from 'better-sqlite3';

import type {
  RequestRecord,
  RequestStore,
  TaskExternalRef
} from './requestStore.js';
import type { RequestStatus } from './engine.js';

type DBRow = {
  request_id: string;
  idempotency_key: string;
  envelope_json: string;
  plan_json: string | null;
  results_json: string | null;
  status: RequestStatus;
  created_at: string;
  updated_at: string;
};

export class SQLiteRequestStore implements RequestStore {
  private db: Database.Database;

  constructor(dbPath = 'data/xcfg.db') {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        request_id TEXT PRIMARY KEY,
        idempotency_key TEXT UNIQUE NOT NULL,
        envelope_json TEXT NOT NULL,
        plan_json TEXT,
        results_json TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS external_refs (
        backend TEXT NOT NULL,
        external_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        UNIQUE(backend, external_id)
      );
      CREATE INDEX IF NOT EXISTS idx_requests_status
        ON requests(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_external_refs_request
        ON external_refs(request_id);
    `);
  }

  async create(record: RequestRecord): Promise<void> {
    const insert = this.db.prepare(
      `INSERT INTO requests
        (request_id, idempotency_key, envelope_json, plan_json, results_json, status, created_at, updated_at)
       VALUES
        (@request_id, @idempotency_key, @envelope_json, @plan_json, @results_json, @status, @created_at, @updated_at)`
    );
    insert.run({
      request_id: record.request_id,
      idempotency_key: record.envelope.idempotency_key,
      envelope_json: JSON.stringify(record.envelope),
      plan_json: record.plan ? JSON.stringify(record.plan) : null,
      results_json: record.results ? JSON.stringify(record.results) : null,
      status: record.status,
      created_at: record.created_at,
      updated_at: record.updated_at
    });
    this.reindexExternalRefs(record.request_id, record.results);
  }

  async update(
    request_id: string,
    patch: Partial<Omit<RequestRecord, 'request_id' | 'created_at'>>
  ): Promise<void> {
    const existing = await this.get(request_id);
    if (!existing) return;
    const updated: RequestRecord = {
      ...existing,
      ...patch,
      updated_at: new Date().toISOString()
    };
    const stmt = this.db.prepare(
      `UPDATE requests SET
        idempotency_key=@idempotency_key,
        envelope_json=@envelope_json,
        plan_json=@plan_json,
        results_json=@results_json,
        status=@status,
        updated_at=@updated_at
       WHERE request_id=@request_id`
    );
    stmt.run({
      request_id,
      idempotency_key: updated.envelope.idempotency_key,
      envelope_json: JSON.stringify(updated.envelope),
      plan_json: updated.plan ? JSON.stringify(updated.plan) : null,
      results_json: updated.results ? JSON.stringify(updated.results) : null,
      status: updated.status,
      updated_at: updated.updated_at
    });
    if (patch.results) {
      this.reindexExternalRefs(request_id, patch.results);
    }
  }

  async get(request_id: string): Promise<RequestRecord | undefined> {
    const row = this.db
      .prepare(`SELECT * FROM requests WHERE request_id = ?`)
      .get(request_id) as DBRow | undefined;
    return row ? this.deserializeRow(row) : undefined;
  }

  async findByIdempotencyKey(
    idempotency_key: string
  ): Promise<RequestRecord | undefined> {
    const row = this.db
      .prepare(`SELECT * FROM requests WHERE idempotency_key = ?`)
      .get(idempotency_key) as DBRow | undefined;
    return row ? this.deserializeRow(row) : undefined;
  }

  async listByStatus(
    statuses: RequestStatus[],
    limit = 100
  ): Promise<RequestRecord[]> {
    if (statuses.length === 0) return [];
    const placeholders = statuses.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT * FROM requests
         WHERE status IN (${placeholders})
         ORDER BY created_at ASC
         LIMIT ?`
      )
      .all(...statuses, limit) as DBRow[];
    return rows.map(r => this.deserializeRow(r));
  }

  async findTaskByExternalId(
    backend: string,
    external_id: string
  ): Promise<TaskExternalRef | undefined> {
    const row = this.db
      .prepare(
        `SELECT request_id, task_id, backend, external_id
         FROM external_refs
         WHERE backend = ? AND external_id = ?`
      )
      .get(backend, external_id) as TaskExternalRef | undefined;
    return row;
  }

  private deserializeRow(row: DBRow): RequestRecord {
    return {
      request_id: row.request_id,
      envelope: JSON.parse(row.envelope_json),
      plan: row.plan_json ? JSON.parse(row.plan_json) : undefined,
      results: row.results_json ? JSON.parse(row.results_json) : undefined,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private reindexExternalRefs(
    request_id: string,
    results?: RequestRecord['results']
  ): void {
    this.db
      .prepare(`DELETE FROM external_refs WHERE request_id = ?`)
      .run(request_id);
    if (!results) return;
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO external_refs
        (backend, external_id, request_id, task_id)
       VALUES
        (@backend, @external_id, @request_id, @task_id)`
    );
    for (const r of results) {
      if (!r.external_id) continue;
      insert.run({
        backend: r.backend,
        external_id: r.external_id,
        request_id,
        task_id: r.task_id
      });
    }
  }
}

