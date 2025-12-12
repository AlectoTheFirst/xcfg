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

