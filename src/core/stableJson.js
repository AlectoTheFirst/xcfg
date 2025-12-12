/**
 * Deterministic JSON stringify (stable object key ordering).
 * @param {any} value
 */
export function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);

  /** @type {Record<string, any>} */
  const out = {};
  for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
    const child = value[key];
    if (child === undefined) continue;
    out[key] = canonicalize(child);
  }
  return out;
}

