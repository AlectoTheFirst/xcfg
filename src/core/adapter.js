/**
 * @typedef {Object} AdapterContext
 * @property {string} request_id
 * @property {any} task
 * @property {Record<string, any>=} config
 * @property {Record<string, string>=} secrets
 * @property {Record<string, any>=} state
 */

/**
 * @typedef {Object} BackendAdapter
 * @property {string} name
 * @property {(task: any, ctx: AdapterContext) => Promise<any>} execute
 * @property {(external_id: string, ctx: AdapterContext) => Promise<string>=} checkStatus
 * @property {(payload: any, ctx: AdapterContext) => Promise<void>=} handleCallback
 */
