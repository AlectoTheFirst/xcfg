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

  async listByRequestId(request_id, limit = 1000) {
    return this.events.filter(e => e.request_id === request_id).slice(0, limit);
  }
}

export class FanoutAuditSink {
  /**
   * @param {AuditSink[]} sinks
   */
  constructor(sinks) {
    this.sinks = sinks;
  }

  async write(event) {
    await Promise.allSettled(this.sinks.map(s => s.write(event)));
  }

  async listByRequestId(request_id, limit = 1000) {
    for (const sink of this.sinks) {
      if (typeof sink?.listByRequestId === 'function') {
        return sink.listByRequestId(request_id, limit);
      }
    }
    throw new Error('Audit sink does not support querying');
  }
}
