import { vectorEntries as memoryEmbeddings, vectorCache } from '@cieljs/vector';
import type { VectorIndex } from '@cieljs/vector';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import type { Database } from './database.ts';
import { MemoryValidationError } from './errors.ts';
import { filterCondition, type MemorySelector } from './query.ts';
import { materializeMemory } from './repository.ts';
import { memories, memoryChunks, memoryRevisions } from './schema.ts';
import { normalizeSearchText } from './search.ts';
import type {
  MemorySearchHit,
  MemorySearchMatch,
  MemorySearchOptions,
  MemorySourceSearchHit,
  MemorySourceSearchOptions,
} from './types.ts';
import { integerOption } from './validation.ts';

interface RawContentHit {
  id: string;
  revision: number;
  excerpt: string;
  score: number;
}

interface RawSourceHit {
  memoryId: string;
  revision: number;
  spaceId: string | null;
  layer: 'global.long_term' | 'space.long_term' | 'space.daily';
  date: string | null;
  sources: string[];
  content: string;
  score: number;
}

type SearchOptions = MemorySearchOptions & { dateFrom?: string; dateTo?: string };

export class MemoryRetrieval {
  constructor(
    private readonly db: Database,
    private readonly embeddingIndex: VectorIndex,
    private readonly tokenize: (text: string) => string[],
  ) {}

  async search(
    selector: MemorySelector,
    query: string,
    options: SearchOptions = {},
  ): Promise<MemorySearchHit[]> {
    const mode = options.mode ?? 'hybrid';

    if (!['hybrid', 'full_text', 'trigram', 'vector'].includes(mode)) {
      throw new MemoryValidationError('无效的内容检索模式');
    }

    if (mode !== 'hybrid') {
      const method = mode as MemorySearchMatch;
      const hits = await this.searchRoute(method, selector, query, options);

      return this.mergeContentHits(selector, [[method, hits]], options);
    }

    const routes = await Promise.all([
      this.searchRoute('full_text', selector, query, options),
      this.searchRoute('trigram', selector, query, options),
      this.searchRoute('vector', selector, query, options).catch((error: unknown) => {
        options.signal?.throwIfAborted();
        this.embeddingIndex.reportError(error);

        return [];
      }),
    ]);

    return this.mergeContentHits(
      selector,
      [
        ['full_text', routes[0]],
        ['trigram', routes[1]],
        ['vector', routes[2]],
      ],
      options,
    );
  }

  // oxlint-disable-next-line eslint/complexity -- 多检索路由的合并、去重和分页需要共享同一命中表。
  async searchBySource(
    selector: MemorySelector,
    query: string,
    options: MemorySourceSearchOptions = {},
  ): Promise<MemorySourceSearchHit[]> {
    options.signal?.throwIfAborted();
    const normalized = query.normalize('NFKC').trim();

    if (!normalized) {
      return [];
    }

    const candidateLimit = integerOption((options.limit ?? 10) + (options.offset ?? 0), 'limit');
    const mode = options.mode ?? 'auto';

    if (!['auto', 'exact', 'text'].includes(mode)) {
      throw new MemoryValidationError('无效的来源检索模式');
    }

    const routes: RawSourceHit[][] = [];

    if (mode === 'auto' || mode === 'exact') {
      routes.push(await this.searchSourceExact(selector, normalized, options, candidateLimit));
    }

    if (mode === 'auto' || mode === 'text') {
      routes.push(await this.searchSourceText(selector, normalized, options, candidateLimit));
    }

    options.signal?.throwIfAborted();
    const merged = new Map<string, RawSourceHit>();

    for (const rows of routes) {
      for (const row of rows) {
        const key = `${row.memoryId}:${row.revision}`;
        const existing = merged.get(key);

        if (!existing || row.score > existing.score) {
          merged.set(key, row);
        }
      }
    }

    const queryText = normalizeSearchText(normalized);
    const queryTokens = this.tokenize(queryText).map(normalizeSearchText).filter(Boolean);
    const offset = integerOption(options.offset ?? 0, 'offset', 0, Number.MAX_SAFE_INTEGER);
    const limit = integerOption(options.limit ?? 10, 'limit');

    return [...merged.values()]
      .sort(
        (left, right) => right.score - left.score || left.memoryId.localeCompare(right.memoryId),
      )
      .slice(offset, offset + limit)
      .map(row => ({
        memoryId: row.memoryId,
        revision: row.revision,
        spaceId: row.spaceId,
        layer: row.layer,
        date: row.date,
        matchedSources: row.sources.filter(source => {
          const sourceText = normalizeSearchText(source);
          const sourceTokens = this.tokenize(sourceText).map(normalizeSearchText);

          return (
            source === normalized ||
            sourceText.includes(queryText) ||
            queryTokens.some(token => sourceTokens.includes(token))
          );
        }),
        excerpt: createExcerpt(row.content),
        score: row.score,
      })) as MemorySourceSearchHit[];
  }

  private async searchRoute(
    method: MemorySearchMatch,
    selector: MemorySelector,
    query: string,
    options: SearchOptions,
  ): Promise<RawContentHit[]> {
    options.signal?.throwIfAborted();
    const normalized = normalizeSearchText(query);

    if (!normalized || selector.layers.length === 0) {
      return [];
    }

    const limit = integerOption(options.candidateLimit ?? 50, 'candidateLimit');
    const filter = filterCondition(selector, options);

    if (method === 'vector') {
      return this.searchVector(query, filter, limit, options);
    }

    let score;
    let match;

    if (method === 'full_text') {
      const tokens = this.tokenize(normalized).map(normalizeSearchText).filter(Boolean).join(' ');

      if (!tokens) {
        return [];
      }

      const document = sql`to_tsvector('simple', ${memoryChunks.tokenText})`;
      const tsQuery = sql`plainto_tsquery('simple', ${tokens})`;
      score = sql<number>`ts_rank_cd(${document}, ${tsQuery})`;
      match = sql`${document} @@ ${tsQuery}`;
    } else {
      const pattern = `%${escapeLike(normalized)}%`;
      score = sql<number>`similarity(${memoryChunks.searchText}, ${normalized})`;
      match = sql`(${memoryChunks.searchText} % ${normalized} OR ${memoryChunks.searchText} LIKE ${pattern})`;
    }

    const rows = await this.db
      .select({
        id: memories.id,
        revision: memoryChunks.revision,
        excerpt: memoryChunks.content,
        score,
      })
      .from(memoryChunks)
      .innerJoin(memories, eq(memories.id, memoryChunks.memoryId))
      .innerJoin(
        memoryRevisions,
        and(
          eq(memoryRevisions.memoryId, memories.id),
          eq(memoryRevisions.revision, memories.currentRevision),
          eq(memoryChunks.revision, memories.currentRevision),
        ),
      )
      .where(and(filter, match))
      .orderBy(desc(score), asc(memoryChunks.id))
      .limit(limit);

    options.signal?.throwIfAborted();

    return rows;
  }

  private async searchVector(
    query: string,
    filter: ReturnType<typeof filterCondition>,
    limit: number,
    options: SearchOptions,
  ): Promise<RawContentHit[]> {
    const model = this.embeddingIndex.model;

    if (!model) {
      return [];
    }

    const threshold = options.minVectorSimilarity ?? 0.35;

    if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1) {
      throw new TypeError('相似度阈值必须在 -1 到 1 之间');
    }

    const vector = await this.embeddingIndex.embedQuery(query, options.signal);

    if (!vector) {
      return [];
    }

    const score = sql<number>`CASE WHEN ${memoryEmbeddings.model} = ${model.model}
      AND ${memoryEmbeddings.dimensions} = ${model.dimensions}
      AND ${memoryEmbeddings.status} = 'ready'
      THEN 1 - (${vectorCache.embedding} <=> ${JSON.stringify(vector)}::vector) ELSE NULL END`;

    const rows = await this.db
      .select({
        id: memories.id,
        revision: memoryChunks.revision,
        excerpt: memoryChunks.content,
        score,
      })
      .from(memoryChunks)
      .innerJoin(memories, eq(memories.id, memoryChunks.memoryId))
      .innerJoin(
        memoryRevisions,
        and(
          eq(memoryRevisions.memoryId, memories.id),
          eq(memoryRevisions.revision, memories.currentRevision),
          eq(memoryChunks.revision, memories.currentRevision),
        ),
      )
      .innerJoin(memoryEmbeddings, eq(memoryEmbeddings.chunkId, memoryChunks.id))
      .innerJoin(vectorCache, eq(vectorCache.key, memoryEmbeddings.cacheKey))
      .where(
        and(
          filter,
          eq(memoryEmbeddings.namespace, model.namespace),
          eq(memoryEmbeddings.model, model.model),
          eq(memoryEmbeddings.dimensions, model.dimensions),
          sql`${score} >= ${threshold}`,
        ),
      )
      .orderBy(desc(score), asc(memoryChunks.id))
      .limit(limit);

    options.signal?.throwIfAborted();

    return rows;
  }

  private async mergeContentHits(
    selector: MemorySelector,
    routes: Array<[MemorySearchMatch, RawContentHit[]]>,
    options: SearchOptions,
  ): Promise<MemorySearchHit[]> {
    const hits = new Map<string, RawContentHit & { matches: MemorySearchMatch[] }>();

    for (const [method, rows] of routes) {
      const seen = new Set<string>();

      for (const row of rows) {
        if (seen.has(row.id)) {
          continue;
        }

        seen.add(row.id);
        const score = (method === 'trigram' ? 0.7 : 1) / (60 + seen.size);
        const existing = hits.get(row.id);

        if (existing) {
          existing.score += score;
          existing.matches.push(method);
        } else {
          hits.set(row.id, { ...row, score, matches: [method] });
        }
      }
    }

    if (!hits.size) {
      return [];
    }

    const memoryIds = [...hits.keys()];
    const condition = and(inArray(memories.id, memoryIds), filterCondition(selector, options));

    const rows = await this.db
      .select({ memory: memories, revision: memoryRevisions })
      .from(memories)
      .innerJoin(
        memoryRevisions,
        and(
          eq(memoryRevisions.memoryId, memories.id),
          eq(memoryRevisions.revision, memories.currentRevision),
        ),
      )
      .where(condition);

    options.signal?.throwIfAborted();
    const offset = integerOption(options.offset ?? 0, 'offset', 0, Number.MAX_SAFE_INTEGER);
    const limit = integerOption(options.limit ?? 10, 'limit');

    return rows
      .flatMap(row => {
        const hit = hits.get(row.memory.id)!;

        if (row.revision.revision !== hit.revision) {
          return [];
        }

        return [
          {
            memory: materializeMemory(row.memory, row.revision),
            excerpt: hit.excerpt,
            score: hit.score,
            matches: hit.matches,
          },
        ];
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.memory.occurredAt.getTime() - left.memory.occurredAt.getTime() ||
          left.memory.id.localeCompare(right.memory.id),
      )
      .slice(offset, offset + limit) as MemorySearchHit[];
  }

  private searchSourceExact(
    selector: MemorySelector,
    query: string,
    options: MemorySourceSearchOptions,
    limit: number,
  ): Promise<RawSourceHit[]> {
    return this.sourceQuery(
      selector,
      options,
      sql`${memoryRevisions.sources} @> ARRAY[${query}]::text[]`,
      sql<number>`2`,
      limit,
    );
  }

  private searchSourceText(
    selector: MemorySelector,
    query: string,
    options: MemorySourceSearchOptions,
    limit: number,
  ): Promise<RawSourceHit[]> {
    const normalized = normalizeSearchText(query);
    const tokens = this.tokenize(normalized).map(normalizeSearchText).filter(Boolean).join(' ');
    const pattern = `%${escapeLike(normalized)}%`;
    const document = sql`to_tsvector('simple', ${memoryRevisions.sourceTokenText})`;
    const tsQuery = sql`plainto_tsquery('simple', ${tokens})`;
    const match = sql`(${document} @@ ${tsQuery} OR ${memoryRevisions.sourceSearchText} % ${normalized} OR ${memoryRevisions.sourceSearchText} LIKE ${pattern})`;
    const score = sql<number>`GREATEST(ts_rank_cd(${document}, ${tsQuery}), similarity(${memoryRevisions.sourceSearchText}, ${normalized}), CASE WHEN ${memoryRevisions.sourceSearchText} LIKE ${pattern} THEN 0.5 ELSE 0 END)`;

    return this.sourceQuery(selector, options, match, score, limit);
  }

  private sourceQuery(
    selector: MemorySelector,
    options: MemorySourceSearchOptions,
    match: ReturnType<typeof sql>,
    score: ReturnType<typeof sql<number>>,
    limit: number,
  ): Promise<RawSourceHit[]> {
    return this.db
      .select({
        memoryId: memories.id,
        revision: memoryRevisions.revision,
        spaceId: memories.spaceId,
        layer: memories.layer,
        date: memories.date,
        sources: memoryRevisions.sources,
        content: memoryRevisions.content,
        score,
      })
      .from(memoryRevisions)
      .innerJoin(memories, eq(memories.id, memoryRevisions.memoryId))
      .where(
        and(
          filterCondition(selector, options),
          options.includeHistory
            ? undefined
            : eq(memoryRevisions.revision, memories.currentRevision),
          match,
        ),
      )
      .orderBy(desc(score), asc(memories.id), desc(memoryRevisions.revision))
      .limit(limit) as Promise<RawSourceHit[]>;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function createExcerpt(content: string): string {
  return Array.from(content).slice(0, 400).join('');
}
