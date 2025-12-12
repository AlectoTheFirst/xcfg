export const XCFG_API_VERSION = '1';
export const XCFG_OPERATIONS = ['plan', 'apply', 'validate', 'rollback'];

/**
 * Minimal runtime guard for the xcfg envelope.
 * @param {any} value
 * @returns {boolean}
 */
export function isXcfgEnvelope(value) {
  return (
    value &&
    value.api_version === XCFG_API_VERSION &&
    typeof value.type === 'string' &&
    typeof value.type_version === 'string' &&
    typeof value.operation === 'string' &&
    typeof value.idempotency_key === 'string' &&
    Object.prototype.hasOwnProperty.call(value, 'payload')
  );
}

