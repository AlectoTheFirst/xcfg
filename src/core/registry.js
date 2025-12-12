export class Registry {
  constructor() {
    /** @type {Map<string, Map<string, any>>} */
    this.translators = new Map();
    /** @type {Map<string, any>} */
    this.adapters = new Map();
  }

  registerTranslator(translator) {
    const versions = this.translators.get(translator.type) ?? new Map();
    versions.set(translator.version, translator);
    this.translators.set(translator.type, versions);
  }

  getTranslator(type, version) {
    return this.translators.get(type)?.get(version);
  }

  registerAdapter(adapter) {
    this.adapters.set(adapter.name, adapter);
  }

  getAdapter(name) {
    return this.adapters.get(name);
  }

  listAdapters() {
    return [...this.adapters.keys()];
  }

  listTranslators() {
    const out = [];
    for (const [type, versions] of this.translators.entries()) {
      out.push({
        type,
        versions: [...versions.keys()].sort((a, b) => a.localeCompare(b))
      });
    }
    out.sort((a, b) => a.type.localeCompare(b.type));
    return out;
  }
}
