export type AuditLevel = 'info' | 'warn' | 'error';

export interface AuditEvent {
  request_id: string;
  timestamp: string;
  level: AuditLevel;
  stage: string;
  message: string;
  data?: unknown;
}

export interface AuditSink {
  write(event: AuditEvent): Promise<void>;
}

export class ConsoleAuditSink implements AuditSink {
  async write(event: AuditEvent): Promise<void> {
    const line = `[${event.timestamp}] [${event.level}] [${event.request_id}] ${event.stage}: ${event.message}`;
    console.log(line, event.data ?? '');
  }
}

export class InMemoryAuditSink implements AuditSink {
  events: AuditEvent[] = [];
  async write(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
}

