import type { UCEEnvelope } from './envelope.js';
import type { ExecutionPlan } from './plan.js';

export interface TranslationContext {
  request_id: string;
  envelope: UCEEnvelope;
}

export interface Translator<TPayload = unknown> {
  type: string;
  version: string;
  schema?: object;
  translate(ctx: TranslationContext, payload: TPayload): Promise<ExecutionPlan>;
}

