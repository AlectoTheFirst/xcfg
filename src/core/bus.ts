export interface MessageBusPublishOptions {
  key?: string;
  headers?: Record<string, string>;
}

export interface MessageBus {
  publish<T = unknown>(
    topic: string,
    message: T,
    options?: MessageBusPublishOptions
  ): Promise<void>;

  subscribe?<T = unknown>(
    topic: string,
    handler: (message: T) => Promise<void>
  ): Promise<void>;
}

export class NoopMessageBus implements MessageBus {
  async publish(): Promise<void> {}
  async subscribe(): Promise<void> {}
}

