import { createHash } from 'node:crypto';

export const firewallRuleChangeTranslator = {
  type: 'firewall-rule-change',
  version: '1',

  validate(_ctx, payload) {
    validateFirewallRuleChangePayload(payload);
  },

  async translate(ctx, payload) {
    const backend = ctx.envelope?.target?.backend_hint ?? 'checkpoint';
    const action = `firewall.rule.${payload.change_kind}`;
    const task = {
      id: stableTaskId(ctx.request_id, [
        'firewall-rule-change',
        '1',
        backend,
        action,
        payload.rule.name
      ]),
      backend,
      action,
      input: payload
    };
    return { tasks: [task] };
  }
};

export const firewallRuleChangeTranslatorV2 = {
  type: 'firewall-rule-change',
  version: '2',

  validate(_ctx, payload) {
    validateFirewallRuleChangePayload(payload);
  },

  async translate(ctx, payload) {
    const backend = ctx.envelope?.target?.backend_hint ?? 'checkpoint';
    const name = payload.rule?.name ?? 'unnamed';

    const ensureObjects = {
      id: stableTaskId(ctx.request_id, [
        'firewall-rule-change',
        '2',
        backend,
        'firewall.objects.ensure',
        name
      ]),
      backend,
      action: 'firewall.objects.ensure',
      input: { rule: payload.rule, policy: payload.policy }
    };

    const applyRule = {
      id: stableTaskId(ctx.request_id, [
        'firewall-rule-change',
        '2',
        backend,
        `firewall.rule.${payload.change_kind}`,
        name
      ]),
      backend,
      action: `firewall.rule.${payload.change_kind}`,
      input: payload,
      depends_on: [ensureObjects.id]
    };

    const installPolicy = {
      id: stableTaskId(ctx.request_id, [
        'firewall-rule-change',
        '2',
        backend,
        'firewall.policy.install',
        name
      ]),
      backend,
      action: 'firewall.policy.install',
      input: { policy: payload.policy, rule: payload.rule?.name },
      depends_on: [applyRule.id]
    };

    return { tasks: [ensureObjects, applyRule, installPolicy] };
  }
};

function validateFirewallRuleChangePayload(payload) {
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
  const rule = payload.rule;
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
}

function stableTaskId(request_id, parts) {
  return createHash('sha256')
    .update([request_id, ...parts].join('|'))
    .digest('hex')
    .slice(0, 24);
}
