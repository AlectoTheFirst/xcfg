import { randomUUID } from 'crypto';
import type { Translator } from '../../core/translator.js';
import type { ExecutionPlan, ExecutionTask } from '../../core/plan.js';

export interface FirewallRuleEndpoint {
  cidr?: string;
  object_id?: string;
}

export interface FirewallService {
  protocol: string;
  port?: number | string;
  service_id?: string;
}

export interface FirewallRuleChangePayload {
  change_kind: 'add' | 'modify' | 'delete';
  rule: {
    name: string;
    action: 'allow' | 'deny';
    source: FirewallRuleEndpoint[];
    destination: FirewallRuleEndpoint[];
    services: FirewallService[];
    comment?: string;
    enabled?: boolean;
    position?: { after?: string; before?: string };
  };
  policy?: {
    package?: string;
    layer?: string;
    domain?: string;
  };
}

export const firewallRuleChangeTranslator: Translator<FirewallRuleChangePayload> =
  {
    type: 'firewall-rule-change',
    version: '1',
    validate(_ctx, payload) {
      if (!payload || typeof payload !== 'object') {
        throw new Error('payload must be an object');
      }
      if (
        payload.change_kind !== 'add' &&
        payload.change_kind !== 'modify' &&
        payload.change_kind !== 'delete'
      ) {
        throw new Error('change_kind must be add|modify|delete');
      }
      const rule = payload.rule as any;
      if (!rule || typeof rule !== 'object') {
        throw new Error('rule is required');
      }
      if (typeof rule.name !== 'string' || rule.name.trim() === '') {
        throw new Error('rule.name is required');
      }
      if (rule.action !== 'allow' && rule.action !== 'deny') {
        throw new Error('rule.action must be allow|deny');
      }
      if (!Array.isArray(rule.source) || rule.source.length === 0) {
        throw new Error('rule.source must be a non-empty array');
      }
      if (!Array.isArray(rule.destination) || rule.destination.length === 0) {
        throw new Error('rule.destination must be a non-empty array');
      }
      if (!Array.isArray(rule.services) || rule.services.length === 0) {
        throw new Error('rule.services must be a non-empty array');
      }
    },
    async translate(ctx, payload): Promise<ExecutionPlan> {
      const backend = ctx.envelope.target?.backend_hint ?? 'checkpoint';
      const task: ExecutionTask = {
        id: randomUUID(),
        backend,
        action: `firewall.rule.${payload.change_kind}`,
        input: payload
      };
      return { tasks: [task] };
    }
  };
