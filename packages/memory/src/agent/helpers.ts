import type { MemoryEntry, MemoryLayer, MemorySearchHit, MemorySource } from '../types.ts';
import { integerOption, normalizeSources } from '../validation.ts';
import type {
  MemorySourceProvider,
  MemorySourceProviderContext,
  ResolvedToolOptions,
} from './types.ts';

export function resolveToolOptions(options: {
  sources?: MemorySource[] | MemorySourceProvider;
  sourcesMode?: 'append' | 'replace';
  searchLimit?: number;
  maxReadChars?: number;
}): ResolvedToolOptions {
  const configuredSources = options.sources;
  const sourceProvider = typeof configuredSources === 'function' ? configuredSources : undefined;

  const staticSources =
    typeof configuredSources === 'function' ? [] : normalizeSources(configuredSources ?? []);

  return {
    sourcesMode: options.sourcesMode ?? 'append',
    searchLimit: integerOption(options.searchLimit ?? 8, 'searchLimit', 1, 20),
    maxReadChars: integerOption(options.maxReadChars ?? 12000, 'maxReadChars', 1, 100000),
    resolveSources: async (context: MemorySourceProviderContext) => {
      context.signal?.throwIfAborted();
      const sources = sourceProvider ? await sourceProvider(context) : staticSources;
      context.signal?.throwIfAborted();

      return normalizeSources(sources);
    },
  };
}

export function memoryResult(details: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(details, null, 2) }],
    details,
  };
}

export function previewMemory(memory: MemoryEntry, maxReadChars: number) {
  return {
    ...memory,
    content: memory.content.slice(0, maxReadChars),
    truncated: memory.content.length > maxReadChars,
  };
}

export function previewSearchHits<Layer extends MemoryLayer>(
  hits: MemorySearchHit<Layer>[],
  maxReadChars: number,
) {
  return hits.map(hit => ({
    ...hit,
    memory: previewMemory(hit.memory, maxReadChars),
    excerpt: hit.excerpt.slice(0, maxReadChars),
  }));
}

export function pageMemory(memory: MemoryEntry, offset: number, maxReadChars: number) {
  const start = integerOption(offset, 'offset', 0, Number.MAX_SAFE_INTEGER);
  const end = Math.min(start + maxReadChars, memory.content.length);

  return {
    memory: { ...memory, content: memory.content.slice(start, end) },
    nextOffset: end < memory.content.length ? end : null,
  };
}

export function parseDate(value: string | undefined): Date | undefined;
export function parseDate(value: string | null | undefined): Date | null | undefined;

export function parseDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('时间必须为有效的 ISO 时间字符串');
  }

  return date;
}
