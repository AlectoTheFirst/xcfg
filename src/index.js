export * from './core/envelope.js';
export * from './core/translator.js';
export * from './core/adapter.js';
export * from './core/plan.js';
export * from './core/registry.js';
export * from './core/audit.js';
export * from './core/sqliteAuditSink.js';
export * from './core/engine.js';
export * from './core/requestStore.js';
export * from './core/sqliteRequestStore.js';
export * from './core/telemetry.js';
export * from './core/bus.js';
export * from './core/runner.js';

import { Registry } from './core/registry.js';
import { XCFGEngine } from './core/engine.js';
import { ConsoleAuditSink } from './core/audit.js';
import { ConsoleTelemetry } from './core/telemetry.js';
import { firewallRuleChangeTranslator } from './examples/translators/firewallRuleChange.js';
import { checkpointAdapter } from './examples/adapters/checkpointAdapter.js';
import { mockAsyncAdapter } from './examples/adapters/mockAsyncAdapter.js';

export function createDefaultEngine(opts = {}) {
  const registry = new Registry();
  registry.registerTranslator(firewallRuleChangeTranslator);
  registry.registerAdapter(checkpointAdapter);
  registry.registerAdapter(mockAsyncAdapter);

  return new XCFGEngine(
    registry,
    opts.audit ?? new ConsoleAuditSink(),
    opts.telemetry ?? new ConsoleTelemetry()
  );
}

