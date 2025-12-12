/**
 * @typedef {Object} MessageBusPublishOptions
 * @property {string=} key
 * @property {Record<string, string>=} headers
 */

/**
 * @typedef {Object} MessageBus
 * @property {(topic: string, message: any, options?: MessageBusPublishOptions) => Promise<void>} publish
 * @property {(topic: string, handler: (message: any) => Promise<void>) => Promise<void>=} subscribe
 */

export class NoopMessageBus {
  async publish() {}
  async subscribe() {}
}

