import { vectorEntries as retrievalEmbeddings, vectorCache } from '@cieljs/vector';
import type { VectorIndex } from '@cieljs/vector';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import type { Database } from './database.ts';
import { SessionValidationError } from './errors.ts';
import { chunkCondition, sessionCondition, type SessionSelector } from './query.ts';
import { materializeMessage, materializeSession } from './repository.ts';
import { retrievalChunks, sessionMessages, sessions } from './schema.ts';
import { normalizeSearchText } from './search.ts';
import type {
  FindSessionsBySourceOptions,
  SessionSearchHit,
  SessionSearchMatch,
  SessionSearchOptions,
  SessionSourceHit,
} from './types.ts';
import { integerOption } from './validation.ts';

interface RawContentHit {
  messageId: string;
  excerpt: string;
  score: number;
}
interface RawSourceHit {
  session: typeof sessions.$inferSelect;
  score: number;
}

export class SessionRetrieval {
  constructor(
    private readonly db: Database,
    private readonly embeddingIndex: VectorIndex,
    private readonly tokenize: (text: string) => string[],
  ) {}

  async search(
    selector: SessionSelector,
    query: string,
    options: SessionSearchOptions = {},
  ): Promise<SessionSearchHit[]> {
    const mode = options.mode ?? 'hybrid';

    if (!['hybrid', 'full_text', 'trigram', 'vector'].includes(mode)) {
      throw new SessionValidationError('无效的 Session 检索模式');
    }

    if (mode !== 'hybrid') {
      const method = mode as SessionSearchMatch;

      return this.mergeContentHits(
        selector,
        [[method, await this.searchRoute(method, selector, query, options)]],
        options,
      );
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

  // oxlint-disable-next-line eslint/complexity -- 精确与全文路由共享合并、排序和来源匹配阶段。
  async findBySource(
    selector: SessionSelector,
    query: string,
    options: FindSessionsBySourceOptions = {},
  ): Promise<SessionSourceHit[]> {
    options.signal?.throwIfAborted();
    const sourceQuery = query.normalize('NFKC').trim();

    if (!sourceQuery) {
      return [];
    }

    const mode = options.mode ?? 'auto';

    if (!['auto', 'exact', 'text'].includes(mode)) {
      throw new SessionValidationError('无效的来源检索模式');
    }

    const offset = integerOption(options.offset ?? 0, 'offset', 0, Number.MAX_SAFE_INTEGER);
    const limit = integerOption(options.limit ?? 10, 'limit');
    const candidateLimit = Math.min(1000, offset + limit);
    const routes: RawSourceHit[][] = [];

    if (mode === 'auto' || mode === 'exact') {
      routes.push(await this.searchSourceExact(selector, sourceQuery, candidateLimit));
    }

    if (mode === 'auto' || mode === 'text') {
      routes.push(await this.searchSourceText(selector, sourceQuery, candidateLimit));
    }

    options.signal?.throwIfAborted();
    const merged = new Map<string, RawSourceHit>();

    for (const rows of routes) {
      for (const row of rows) {
        const existing = merged.get(row.session.id);

        if (!existing || row.score > existing.score) {
          merged.set(row.session.id, row);
        }
      }
    }

    const normalizedQuery = normalizeSearchText(sourceQuery);
    const queryTokens = this.tokenize(normalizedQuery).map(normalizeSearchText).filter(Boolean);

    return [...merged.values()]
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.session.updatedAt.getTime() - left.session.updatedAt.getTime() ||
          left.session.id.localeCompare(right.session.id),
      )
      .slice(offset, offset + limit)
      .map(row => ({
        session: materializeSession(row.session),
        matchedSources: row.session.sources.filter(source => {
          const sourceText = normalizeSearchText(source);
          const sourceTokens = this.tokenize(sourceText).map(normalizeSearchText);

          return (
            source === sourceQuery ||
            sourceText.includes(normalizedQuery) ||
            queryTokens.some(token => sourceTokens.includes(token))
          );
        }),
        score: row.score,
      }));
  }

  private async searchRoute(
    method: SessionSearchMatch,
    selector: SessionSelector,
    query: string,
    options: SessionSearchOptions,
  ): Promise<RawContentHit[]> {
    options.signal?.throwIfAborted();
    const normalized = normalizeSearchText(query);

    if (!normalized) {
      return [];
    }

    const limit = integerOption(options.candidateLimit ?? 50, 'candidateLimit');

    if (method === 'vector') {
      return this.searchVector(selector, query, limit, options);
    }

    let score;
    let match;

    if (method === 'full_text') {
      const tokens = this.tokenize(normalized).map(normalizeSearchText).filter(Boolean).join(' ');

      if (!tokens) {
        return [];
      }

      const document = sql`to_tsvector('simple', ${retrievalChunks.tokenText})`;
      const tsQuery = sql`plainto_tsquery('simple', ${tokens})`;
      score = sql<number>`ts_rank_cd(${document}, ${tsQuery})`;
      match = sql`${document} @@ ${tsQuery}`;
    } else {
      const pattern = `%${escapeLike(normalized)}%`;
      score = sql<number>`similarity(${retrievalChunks.searchText}, ${normalized})`;
      match = sql`(${retrievalChunks.searchText} % ${normalized} OR ${retrievalChunks.searchText} LIKE ${pattern})`;
    }

    const rows = await this.db
      .select({ messageId: retrievalChunks.messageId, excerpt: retrievalChunks.content, score })
      .from(retrievalChunks)
      .where(and(chunkCondition(selector), match))
      .orderBy(desc(score), asc(retrievalChunks.id))
      .limit(limit);

    options.signal?.throwIfAborted();

    return rows;
  }

  private async searchVector(
    selector: SessionSelector,
    query: string,
    limit: number,
    options: SessionSearchOptions,
  ): Promise<RawContentHit[]> {
    const model = this.embeddingIndex.model;

    if (!model) {
      return [];
    }

    const threshold = options.minVectorSimilarity ?? 0.35;

    if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1) {
      throw new SessionValidationError('相似度阈值必须在 -1 到 1 之间');
    }

    const vector = await this.embeddingIndex.embedQuery(query, options.signal);

    if (!vector) {
      return [];
    }

    const score = sql<number>`CASE WHEN ${retrievalEmbeddings.model} = ${model.model}
      AND ${retrievalEmbeddings.dimensions} = ${model.dimensions}
      AND ${retrievalEmbeddings.status} = 'ready'
      THEN 1 - (${vectorCache.embedding} <=> ${JSON.stringify(vector)}::vector) ELSE NULL END`;

    const rows = await this.db
      .select({ messageId: retrievalChunks.messageId, excerpt: retrievalChunks.content, score })
      .from(retrievalChunks)
      .innerJoin(retrievalEmbeddings, eq(retrievalEmbeddings.chunkId, retrievalChunks.id))
      .innerJoin(vectorCache, eq(vectorCache.key, retrievalEmbeddings.cacheKey))
      .where(
        and(
          chunkCondition(selector),
          eq(retrievalEmbeddings.namespace, model.namespace),
          eq(retrievalEmbeddings.model, model.model),
          eq(retrievalEmbeddings.dimensions, model.dimensions),
          eq(retrievalEmbeddings.status, 'ready'),
          sql`${score} >= ${threshold}`,
        ),
      )
      .orderBy(desc(score), asc(retrievalChunks.id))
      .limit(limit);

    options.signal?.throwIfAborted();

    return rows;
  }

  private async mergeContentHits(
    selector: SessionSelector,
    routes: Array<[SessionSearchMatch, RawContentHit[]]>,
    options: SessionSearchOptions,
  ): Promise<SessionSearchHit[]> {
    const hits = new Map<string, RawContentHit & { matches: SessionSearchMatch[] }>();

    for (const [method, rows] of routes) {
      const seen = new Set<string>();

      for (const row of rows) {
        if (seen.has(row.messageId)) {
          continue;
        }

        seen.add(row.messageId);
        const score = (method === 'trigram' ? 0.7 : 1) / (60 + seen.size);
        const existing = hits.get(row.messageId);

        if (existing) {
          existing.score += score;
          existing.matches.push(method);
        } else {
          hits.set(row.messageId, { ...row, score, matches: [method] });
        }
      }
    }

    if (!hits.size) {
      return [];
    }

    const messageIds = [...hits.keys()];
    const condition = and(inArray(sessionMessages.id, messageIds), sessionCondition(selector));

    const rows = await this.db
      .select({
        message: {
          id: sessionMessages.id,
          sessionId: sessionMessages.sessionId,
          seq: sessionMessages.seq,
          message: sessionMessages.message,
          createdAt: sessionMessages.createdAt,
        },
        spaceId: sessions.spaceId,
      })
      .from(sessionMessages)
      .innerJoin(sessions, eq(sessions.id, sessionMessages.sessionId))
      .where(condition);

    options.signal?.throwIfAborted();
    const offset = integerOption(options.offset ?? 0, 'offset', 0, Number.MAX_SAFE_INTEGER);
    const limit = integerOption(options.limit ?? 10, 'limit');

    return rows
      .map(row => {
        const hit = hits.get(row.message.id)!;

        return {
          spaceId: row.spaceId,
          message: materializeMessage(row.message),
          excerpt: hit.excerpt,
          score: hit.score,
          matches: hit.matches,
        };
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.message.createdAt.getTime() - left.message.createdAt.getTime() ||
          left.message.id.localeCompare(right.message.id),
      )
      .slice(offset, offset + limit);
  }

  private searchSourceExact(
    selector: SessionSelector,
    query: string,
    limit: number,
  ): Promise<RawSourceHit[]> {
    return this.sourceQuery(
      selector,
      sql`${sessions.sources} @> ARRAY[${query}]::text[]`,
      sql<number>`2`,
      limit,
    );
  }

  private searchSourceText(
    selector: SessionSelector,
    query: string,
    limit: number,
  ): Promise<RawSourceHit[]> {
    const normalized = normalizeSearchText(query);
    const tokens = this.tokenize(normalized).map(normalizeSearchText).filter(Boolean).join(' ');
    const pattern = `%${escapeLike(normalized)}%`;
    const document = sql`to_tsvector('simple', ${sessions.sourceTokenText})`;
    const tsQuery = sql`plainto_tsquery('simple', ${tokens})`;
    const match = sql`(${document} @@ ${tsQuery} OR ${sessions.sourceSearchText} % ${normalized} OR ${sessions.sourceSearchText} LIKE ${pattern})`;
    const score = sql<number>`GREATEST(ts_rank_cd(${document}, ${tsQuery}), similarity(${sessions.sourceSearchText}, ${normalized}), CASE WHEN ${sessions.sourceSearchText} LIKE ${pattern} THEN 0.5 ELSE 0 END)`;

    return this.sourceQuery(selector, match, score, limit);
  }

  private sourceQuery(
    selector: SessionSelector,
    match: ReturnType<typeof sql>,
    score: ReturnType<typeof sql<number>>,
    limit: number,
  ): Promise<RawSourceHit[]> {
    return this.db
      .select({ session: sessions, score })
      .from(sessions)
      .where(and(sessionCondition(selector), match))
      .orderBy(desc(score), desc(sessions.updatedAt), asc(sessions.id))
      .limit(limit) as Promise<RawSourceHit[]>;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
