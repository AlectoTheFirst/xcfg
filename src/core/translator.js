/**
 * @typedef {Object} TranslationContext
 * @property {string} request_id
 * @property {any} envelope
 */

/**
 * @typedef {Object} Translator
 * @property {string} type
 * @property {string} version
 * @property {object=} schema
 * @property {(ctx: TranslationContext, payload: any) => (Promise<void> | void)=} validate
 * @property {(ctx: TranslationContext, payload: any) => Promise<any>} translate
 */

