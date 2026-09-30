export type SessionSources = string[] | (() => string[]);

export function createSourceResolver(sources: SessionSources = []) {
  return () => normalizeSources(typeof sources === 'function' ? sources() : sources);
}

export function normalizeSources(sources: string[]) {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    const value = source.trim();

    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    normalized.push(value);
  }

  return normalized;
}
