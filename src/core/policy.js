/**
 * @typedef {'allow'|'deny'} PolicyDecision
 */

/**
 * @typedef {'warn'|'deny'} PolicyEffect
 */

/**
 * @typedef {Object} PolicyViolation
 * @property {string} id
 * @property {PolicyEffect} effect
 * @property {string} message
 * @property {any=} data
 */

/**
 * @typedef {Object} PolicyContext
 * @property {string} request_id
 * @property {any} envelope
 * @property {any=} plan
 */

/**
 * @typedef {Object} PolicyRule
 * @property {string} id
 * @property {(ctx: PolicyContext) => PolicyViolation[] | Promise<PolicyViolation[]>} evaluate
 */

/**
 * @typedef {Object} PolicyResult
 * @property {PolicyDecision} decision
 * @property {PolicyViolation[]} violations
 */

export class PolicyEngine {
  /**
   * @param {PolicyRule[]} rules
   */
  constructor(rules = []) {
    this.rules = rules;
  }

  /**
   * @param {PolicyContext} ctx
   * @returns {Promise<PolicyResult>}
   */
  async evaluate(ctx) {
    /** @type {PolicyViolation[]} */
    const violations = [];
    for (const rule of this.rules) {
      const out = await rule.evaluate(ctx);
      if (Array.isArray(out) && out.length > 0) {
        for (const v of out) {
          if (!v || typeof v !== 'object') continue;
          if (typeof v.id !== 'string' || v.id.trim() === '') continue;
          if (v.effect !== 'warn' && v.effect !== 'deny') continue;
          if (typeof v.message !== 'string' || v.message.trim() === '') continue;
          violations.push(v);
        }
      }
    }

    const decision = violations.some(v => v.effect === 'deny') ? 'deny' : 'allow';
    return { decision, violations };
  }
}

