import type { BackendAdapter } from './adapter.js';
import type { Translator } from './translator.js';

export class Registry {
  private translators = new Map<string, Map<string, Translator>>();
  private adapters = new Map<string, BackendAdapter>();

  registerTranslator(translator: Translator): void {
    const versions = this.translators.get(translator.type) ?? new Map();
    versions.set(translator.version, translator);
    this.translators.set(translator.type, versions);
  }

  getTranslator(type: string, version: string): Translator | undefined {
    return this.translators.get(type)?.get(version);
  }

  registerAdapter(adapter: BackendAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  getAdapter(name: string): BackendAdapter | undefined {
    return this.adapters.get(name);
  }

  listAdapters(): string[] {
    return [...this.adapters.keys()];
  }
}

