import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class SQLiteAuditSink {
  constructor(dbPath = 'data/xcfg.db') {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
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

  async write(event) {
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
        data_json: event.data === undefined ? null : JSON.stringify(event.data)
      });
  }

  async listByRequestId(request_id, limit = 1000) {
    const rows = this.db
      .prepare(
        `SELECT request_id, timestamp, level, stage, message, data_json
         FROM audit_events
         WHERE request_id = ?
         ORDER BY id ASC
         LIMIT ?`
      )
      .all(request_id, limit);

    return rows.map(r => ({
      request_id: r.request_id,
      timestamp: r.timestamp,
      level: r.level,
      stage: r.stage,
      message: r.message,
      data: r.data_json ? JSON.parse(r.data_json) : undefined
    }));
  }
}

