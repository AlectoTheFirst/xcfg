export type UCEOperation = 'plan' | 'apply' | 'validate' | 'rollback';

export interface RequestedBy {
  system?: string;
  user?: string;
  email?: string;
}

export interface TargetHint {
  backend_hint?: string;
  domain?: string;
  site?: string;
  tenant?: string;
  [key: string]: string | undefined;
}

export interface UCEEnvelope<TPayload = unknown> {
  api_version: '1';
  type: string;
  type_version: string;
  operation: UCEOperation;
  idempotency_key: string;
  correlation_id?: string;
  requested_by?: RequestedBy;
  target?: TargetHint;
  payload: TPayload;
  tags?: Record<string, string>;
  created_at?: string;
}

