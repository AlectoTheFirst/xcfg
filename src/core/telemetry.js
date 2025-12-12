import { performance } from 'node:perf_hooks';

/**
 * @typedef {'ok'|'error'} SpanStatus
 */

/**
 * @typedef {Object} Span
 * @property {(name: string, attrs?: Record<string, unknown>) => void} addEvent
 * @property {(err: unknown) => void} recordException
 * @property {(status?: SpanStatus) => void} end
 */

/**
 * @typedef {Object} Tracer
 * @property {(name: string, attrs?: Record<string, unknown>) => Span} startSpan
 */

/**
 * @typedef {Object} Metrics
 * @property {(name: string, value?: number, labels?: Record<string, string>) => void} incCounter
 * @property {(name: string, value: number, labels?: Record<string, string>) => void} observeHistogram
 * @property {(() => { counters: Record<string, number>, histograms: Record<string, {count:number,sum:number,min:number,max:number}> })=} snapshot
 */

/**
 * @typedef {Object} Telemetry
 * @property {Tracer} tracer
 * @property {Metrics} metrics
 */

class NoopSpan {
  addEvent() {}
  recordException() {}
  end() {}
}

class NoopTracer {
  startSpan() {
    return new NoopSpan();
  }
}

class NoopMetrics {
  incCounter() {}
  observeHistogram() {}
}

export const NoopTelemetry = {
  tracer: new NoopTracer(),
  metrics: new NoopMetrics()
};

/**
 * @typedef {{ count:number, sum:number, min:number, max:number }} Histogram
 */

export class InMemoryMetrics {
  constructor() {
    /** @type {Map<string, number>} */
    this.counters = new Map();
    /** @type {Map<string, Histogram>} */
    this.histograms = new Map();
  }

  /**
   * @param {string} name
   * @param {Record<string,string>=} labels
   */
  key(name, labels) {
    if (!labels || Object.keys(labels).length === 0) return name;
    const suffix = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return `${name}{${suffix}}`;
  }

  incCounter(name, value = 1, labels) {
    const key = this.key(name, labels);
    const current = this.counters.get(key) ?? 0;
    this.counters.set(key, current + value);
  }

  observeHistogram(name, value, labels) {
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
    /** @type {Record<string, number>} */
    const counters = {};
    for (const [k, v] of this.counters) counters[k] = v;

    /** @type {Record<string, Histogram>} */
    const histograms = {};
    for (const [k, v] of this.histograms) histograms[k] = { ...v };
    return { counters, histograms };
  }
}

export class ConsoleTracer {
  startSpan(name, attrs) {
    const start = performance.now();
    console.log(`[trace] start ${name}`, attrs ?? {});
    return {
      addEvent(eventName, eventAttrs) {
        console.log(`[trace] event ${name}:${eventName}`, eventAttrs ?? {});
      },
      recordException(err) {
        console.log(`[trace] exception ${name}`, err);
      },
      end(status = 'ok') {
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

export class ConsoleTelemetry {
  constructor() {
    this.tracer = new ConsoleTracer();
    this.metrics = new InMemoryMetrics();
  }
}

