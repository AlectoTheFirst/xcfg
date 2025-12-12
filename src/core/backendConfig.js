export const DEFAULT_BACKENDS_CONFIG = {
  backends: {},
  profiles: []
};

export const DEFAULT_SECRETS_CONFIG = {
  backends: {}
};

/**
 * Resolve backend config for a given task using profile overrides pinned to metadata.
 *
 * @param {any} rawConfig
 * @param {any} envelope
 * @param {any} plan
 * @param {any} task
 */
export function resolveBackendConfig(rawConfig, envelope, plan, task) {
  const config = normalizeBackendsConfig(rawConfig);
  const backend = typeof task?.backend === 'string' ? task.backend : undefined;

  const selection = selectProfiles(config.profiles, envelope, plan, task);
  const base = (backend && config.backends?.[backend]) ?? {};
  let merged = deepMerge(deepMerge({}, base), {});

  for (const profile of selection.matched) {
    const override = profile.override;
    const perBackend = override?.backends?.[backend];
    if (perBackend) {
      merged = deepMerge(merged, perBackend);
    }
  }

  return {
    backend,
    config: merged,
    matched_profiles: selection.matched_profiles,
    environment: selection.environment
  };
}

/**
 * @param {any} rawSecrets
 * @param {any} task
 */
export function resolveBackendSecrets(rawSecrets, task) {
  const secretsConfig = normalizeSecretsConfig(rawSecrets);
  const backend = typeof task?.backend === 'string' ? task.backend : undefined;
  const secrets = (backend && secretsConfig.backends?.[backend]) ?? {};
  return { backend, secrets };
}

function normalizeBackendsConfig(config) {
  if (!config || typeof config !== 'object') return DEFAULT_BACKENDS_CONFIG;
  return {
    backends: isPlainObject(config.backends) ? config.backends : {},
    profiles: Array.isArray(config.profiles) ? config.profiles : []
  };
}

function normalizeSecretsConfig(config) {
  if (!config || typeof config !== 'object') return DEFAULT_SECRETS_CONFIG;
  return {
    backends: isPlainObject(config.backends) ? config.backends : {}
  };
}

function selectProfiles(profiles, envelope, plan, task) {
  const environment = inferEnvironment(envelope);
  const planTasks = plan?.tasks ?? [];
  const backends = uniqueStrings(planTasks.map(t => t?.backend));
  const actions = uniqueStrings(planTasks.map(t => t?.action));

  const context = { envelope, plan, task, environment, backends, actions };

  const matched = [];
  for (const profile of profiles ?? []) {
    if (!isPlainObject(profile)) continue;
    const match = isPlainObject(profile.match) ? profile.match : {};
    if (!matchesProfile(match, context)) continue;
    matched.push({
      name: typeof profile.name === 'string' ? profile.name : 'unnamed',
      priority: Number.isFinite(profile.priority) ? profile.priority : 0,
      override: isPlainObject(profile.override) ? profile.override : {}
    });
  }

  matched.sort((a, b) => a.priority - b.priority);

  return {
    environment,
    matched,
    matched_profiles: matched.map(p => ({ name: p.name, priority: p.priority }))
  };
}

function inferEnvironment(envelope) {
  const tagEnv = envelope?.tags?.environment;
  if (typeof tagEnv === 'string' && tagEnv.trim() !== '') return tagEnv.trim();
  const targetEnv = envelope?.target?.environment;
  if (typeof targetEnv === 'string' && targetEnv.trim() !== '') {
    return targetEnv.trim();
  }
  return undefined;
}

function matchesProfile(match, context) {
  for (const [rawKey, expected] of Object.entries(match)) {
    if (rawKey === '$or') {
      if (!Array.isArray(expected) || expected.length === 0) return false;
      if (
        !expected.some(
          sub => isPlainObject(sub) && matchesProfile(sub, context)
        )
      ) {
        return false;
      }
      continue;
    }

    const actual = readMatchValue(context, rawKey);
    if (!matchValue(actual, expected)) return false;
  }
  return true;
}

function readMatchValue(context, key) {
  if (key === 'environment') return context.environment;
  if (key === 'type') return context.envelope?.type;
  if (key === 'type_version') return context.envelope?.type_version;
  if (key === 'operation') return context.envelope?.operation;

  if (key === 'plan.backends') return context.backends;
  if (key === 'plan.actions') return context.actions;

  if (key === 'backend') {
    if (typeof context.task?.backend === 'string') return context.task.backend;
    return context.backends.length === 1 ? context.backends[0] : undefined;
  }

  if (key.startsWith('tags.')) {
    return getPath(context.envelope?.tags, key.slice('tags.'.length));
  }
  if (key.startsWith('target.')) {
    return getPath(context.envelope?.target, key.slice('target.'.length));
  }
  if (key.startsWith('requested_by.')) {
    return getPath(context.envelope?.requested_by, key.slice('requested_by.'.length));
  }
  if (key.startsWith('payload.')) {
    return getPath(context.envelope?.payload, key.slice('payload.'.length));
  }

  return undefined;
}

function matchValue(actual, expected) {
  if (Array.isArray(expected)) {
    return expected.some(value => matchValue(actual, value));
  }
  if (Array.isArray(actual)) {
    return actual.includes(expected);
  }
  return actual === expected;
}

function getPath(value, path) {
  if (!path) return value;
  const parts = path.split('.').filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

function deepMerge(base, override) {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return clone(override);

  /** @type {Record<string, any>} */
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v === undefined) continue;
    const existing = out[k];
    if (isPlainObject(existing) && isPlainObject(v)) {
      out[k] = deepMerge(existing, v);
    } else {
      out[k] = clone(v);
    }
  }
  return out;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isPlainObject(value)) return deepMerge({}, value);
  return value;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

