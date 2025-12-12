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
    value.type.trim() !== '' &&
    typeof value.type_version === 'string' &&
    value.type_version.trim() !== '' &&
    typeof value.operation === 'string' &&
    XCFG_OPERATIONS.includes(value.operation) &&
    typeof value.idempotency_key === 'string' &&
    value.idempotency_key.trim() !== '' &&
    Object.prototype.hasOwnProperty.call(value, 'payload')
  );
}
