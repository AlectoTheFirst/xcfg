import { performance } from 'perf_hooks';

export type SpanStatus = 'ok' | 'error';

export interface Span {
  addEvent(name: string, attrs?: Record<string, unknown>): void;
  recordException(err: unknown): void;
  end(status?: SpanStatus): void;
}

export interface Tracer {
  startSpan(name: string, attrs?: Record<string, unknown>): Span;
}

export interface Metrics {
  incCounter(
    name: string,
    value?: number,
    labels?: Record<string, string>
  ): void;
  observeHistogram(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): void;
  snapshot?(): {
    counters: Record<string, number>;
    histograms: Record<
      string,
      { count: number; sum: number; min: number; max: number }
    >;
  };
}

export interface Telemetry {
  tracer: Tracer;
  metrics: Metrics;
}

class NoopSpan implements Span {
  addEvent(): void {}
  recordException(): void {}
  end(): void {}
}

class NoopTracer implements Tracer {
  startSpan(): Span {
    return new NoopSpan();
  }
}

class NoopMetrics implements Metrics {
  incCounter(): void {}
  observeHistogram(): void {}
}

export const NoopTelemetry: Telemetry = {
  tracer: new NoopTracer(),
  metrics: new NoopMetrics()
};

type Histogram = { count: number; sum: number; min: number; max: number };

export class InMemoryMetrics implements Metrics {
  private counters = new Map<string, number>();
  private histograms = new Map<string, Histogram>();

  private key(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) return name;
    const suffix = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return `${name}{${suffix}}`;
  }

  incCounter(
    name: string,
    value = 1,
    labels?: Record<string, string>
  ): void {
    const key = this.key(name, labels);
    const current = this.counters.get(key) ?? 0;
    this.counters.set(key, current + value);
  }

  observeHistogram(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): void {
    const key = this.key(name, labels);
    const current = this.histograms.get(key);
    if (!current) {
      this.histograms.set(key, {
        count: 1,
        sum: value,
        min: value,
        max: value
      });
      return;
    }
    current.count += 1;
    current.sum += value;
    current.min = Math.min(current.min, value);
    current.max = Math.max(current.max, value);
  }

  snapshot() {
    const counters: Record<string, number> = {};
    for (const [k, v] of this.counters) counters[k] = v;
    const histograms: Record<string, Histogram> = {};
    for (const [k, v] of this.histograms) histograms[k] = { ...v };
    return { counters, histograms };
  }
}

export class ConsoleTracer implements Tracer {
  startSpan(name: string, attrs?: Record<string, unknown>): Span {
    const start = performance.now();
    console.log(`[trace] start ${name}`, attrs ?? {});
    return {
      addEvent(eventName, eventAttrs) {
        console.log(`[trace] event ${name}:${eventName}`, eventAttrs ?? {});
      },
      recordException(err) {
        console.log(`[trace] exception ${name}`, err);
      },
      end(status: SpanStatus = 'ok') {
        const duration_ms = performance.now() - start;
        console.log(
          `[trace] end ${name} status=${status} duration_ms=${duration_ms.toFixed(
            1
          )}`
        );
      }
    };
  }
}

export class ConsoleTelemetry implements Telemetry {
  tracer: Tracer;
  metrics: InMemoryMetrics;

  constructor() {
    this.tracer = new ConsoleTracer();
    this.metrics = new InMemoryMetrics();
  }
}

