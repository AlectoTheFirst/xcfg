import { mkdirSync } from 'fs';
import { dirname } from 'path';
import Database from 'better-sqlite3';

import type { AuditEvent, AuditSink } from './audit.js';

type DBRow = {
  request_id: string;
  timestamp: string;
  level: string;
  stage: string;
  message: string;
  data_json: string | null;
};

export class SQLiteAuditSink implements AuditSink {
  private db: Database.Database;

  constructor(dbPath = 'data/xcfg.db') {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        stage TEXT NOT NULL,
        message TEXT NOT NULL,
        data_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_events_request
        ON audit_events(request_id, timestamp);
    `);
  }

  async write(event: AuditEvent): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO audit_events
          (request_id, timestamp, level, stage, message, data_json)
         VALUES
          (@request_id, @timestamp, @level, @stage, @message, @data_json)`
      )
      .run({
        request_id: event.request_id,
        timestamp: event.timestamp,
        level: event.level,
        stage: event.stage,
        message: event.message,
        data_json:
          event.data === undefined ? null : JSON.stringify(event.data)
      });
  }

  async listByRequestId(
    request_id: string,
    limit = 1000
  ): Promise<AuditEvent[]> {
    const rows = this.db
      .prepare(
        `SELECT request_id, timestamp, level, stage, message, data_json
         FROM audit_events
         WHERE request_id = ?
         ORDER BY id ASC
         LIMIT ?`
      )
      .all(request_id, limit) as DBRow[];

    return rows.map(r => ({
      request_id: r.request_id,
      timestamp: r.timestamp,
      level: r.level as AuditEvent['level'],
      stage: r.stage,
      message: r.message,
      data: r.data_json ? JSON.parse(r.data_json) : undefined
    }));
  }
}

