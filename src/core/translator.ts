import type { XCFGEnvelope } from './envelope.js';
import type { ExecutionPlan } from './plan.js';

export interface TranslationContext {
  request_id: string;
  envelope: XCFGEnvelope;
}

export interface Translator<TPayload = unknown> {
  type: string;
  version: string;
  schema?: object;
  validate?(
    ctx: TranslationContext,
    payload: TPayload
  ): Promise<void> | void;
  translate(ctx: TranslationContext, payload: TPayload): Promise<ExecutionPlan>;
}
