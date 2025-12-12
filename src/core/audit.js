/**
 * @typedef {'info'|'warn'|'error'} AuditLevel
 */

/**
 * @typedef {Object} AuditEvent
 * @property {string} request_id
 * @property {string} timestamp
 * @property {AuditLevel} level
 * @property {string} stage
 * @property {string} message
 * @property {any=} data
 */

/**
 * @typedef {Object} AuditSink
 * @property {(event: AuditEvent) => Promise<void>} write
 */

export class ConsoleAuditSink {
  /**
   * @param {AuditEvent} event
   */
  async write(event) {
    const line = `[${event.timestamp}] [${event.level}] [${event.request_id}] ${event.stage}: ${event.message}`;
    console.log(line, event.data ?? '');
  }
}

export class InMemoryAuditSink {
  constructor() {
    /** @type {AuditEvent[]} */
    this.events = [];
  }

  /**
   * @param {AuditEvent} event
   */
  async write(event) {
    this.events.push(event);
  }
}

