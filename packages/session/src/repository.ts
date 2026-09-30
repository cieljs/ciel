import type { RuntimeRecord } from '@cieljs/agent-kit/protocol';
import { type Storage, type Transaction } from '@cieljs/storage';
import type { VectorIndex } from '@cieljs/vector';
import { and, asc, between, desc, eq, gt, inArray, sql } from 'drizzle-orm';

import type { Database } from './database.ts';
import {
  SessionCompactionConflictError,
  SessionNotFoundError,
  SessionValidationError,
} from './errors.ts';
import {
  chunkCondition,
  messageCondition,
  sessionCondition,
  type SessionSelector,
} from './query.ts';
import {
  retrievalChunks,
  sessionCompactions,
  sessionMessages,
  sessionMessageLinks,
  sessions,
} from './schema.ts';
import { chunkSearchText, messageToSearchText, normalizeSearchText } from './search.ts';
import type {
  AppendCompactionInput,
  SessionCompaction,
  SessionInfo,
  SessionListOptions,
  SessionMessage,
  SessionMessageListOptions,
  SessionOptions,
  UpdateSessionInput,
} from './types.ts';
import { integerOption, normalizeSources } from './validation.ts';

type SessionRow = typeof sessions.$inferSelect;
type MessageRow = typeof sessionMessages.$inferSelect;
type CompactionRow = typeof sessionCompactions.$inferSelect;

export class SessionRepository {
  constructor(
    private readonly db: Database,
    private readonly embeddingIndex: VectorIndex,
    private readonly storage: Storage,
    private readonly tokenize: (text: string) => string[],
  ) {}

  // oxlint-disable-next-line eslint/complexity -- 创建、冲突更新与回读共同实现 open 的幂等契约。
  async open(selector: SessionSelector, options: SessionOptions): Promise<SessionInfo> {
    const id = options.id ?? crypto.randomUUID();
    const spaceId = selector.spaceId;
    const title = normalizeTitle(options.title);

    if (!id.trim()) {
      throw new SessionValidationError('Session id 不能为空');
    }

    if (!spaceId) {
      throw new SessionValidationError('spaceId 不能为空');
    }

    const providedSources =
      options.sources === undefined ? undefined : normalizeSources(options.sources);

    const createdAt = new Date();

    const [created] = await this.db
      .insert(sessions)
      .values({
        id,
        spaceId,
        namespace: selector.namespace!,
        title,
        sources: providedSources ?? [],
        sourceSearchText: normalizeSearchText((providedSources ?? []).join('\n')),
        sourceTokenText: this.toTokenText((providedSources ?? []).join('\n')),
        createdAt,
        updatedAt: createdAt,
      })
      .onConflictDoNothing({ target: sessions.id })
      .returning();

    if (created) {
      return materializeSession(created);
    }

    if (providedSources !== undefined || options.title !== undefined) {
      const updates = {
        ...(providedSources === undefined
          ? {}
          : {
              sources: providedSources,
              sourceSearchText: normalizeSearchText(providedSources.join('\n')),
              sourceTokenText: this.toTokenText(providedSources.join('\n')),
            }),
        ...(options.title === undefined ? {} : { title }),
        updatedAt: new Date(),
      };

      const [updated] = await this.db
        .update(sessions)
        .set(updates)
        .where(sessionCondition({ namespace: selector.namespace, spaceId, sessionId: id }))
        .returning();

      if (updated) {
        return materializeSession(updated);
      }
    }

    const existing = await this.getInfo({ namespace: selector.namespace, spaceId, sessionId: id });

    if (!existing) {
      throw new SessionNotFoundError();
    }

    return existing;
  }

  async getInfo(selector: SessionSelector): Promise<SessionInfo | null> {
    const [row] = await this.db.select().from(sessions).where(sessionCondition(selector)).limit(1);

    return row ? materializeSession(row) : null;
  }

  async list(
    selector: SessionSelector = {},
    options: SessionListOptions = {},
  ): Promise<SessionInfo[]> {
    const limit = integerOption(options.limit ?? 50, 'limit');
    const offset = integerOption(options.offset ?? 0, 'offset', 0, Number.MAX_SAFE_INTEGER);

    const rows = await this.db
      .select()
      .from(sessions)
      .where(sessionCondition(selector))
      .orderBy(desc(sessions.updatedAt), asc(sessions.id))
      .limit(limit)
      .offset(offset);

    return rows.map(materializeSession);
  }

  async update(selector: SessionSelector, input: UpdateSessionInput): Promise<SessionInfo> {
    if (input.sources === undefined && input.title === undefined) {
      throw new SessionValidationError('至少提供一个要更新的字段');
    }

    const sources = input.sources === undefined ? undefined : normalizeSources(input.sources);
    const title = normalizeTitle(input.title);

    const updates = {
      ...(sources === undefined
        ? {}
        : {
            sources,
            sourceSearchText: normalizeSearchText(sources.join('\n')),
            sourceTokenText: this.toTokenText(sources.join('\n')),
          }),
      ...(input.title === undefined ? {} : { title }),
      updatedAt: new Date(),
    };

    const [row] = await this.db
      .update(sessions)
      .set(updates)
      .where(sessionCondition(selector))
      .returning();

    if (!row) {
      throw new SessionNotFoundError();
    }

    return materializeSession(row);
  }

  async delete(selector: SessionSelector): Promise<void> {
    const [row] = await this.db
      .delete(sessions)
      .where(sessionCondition(selector))
      .returning({ id: sessions.id });

    if (!row) {
      throw new SessionNotFoundError();
    }
  }

  async appendMessage(
    selector: SessionSelector,
    message: MessageRow['message'],
  ): Promise<SessionMessage> {
    const record = await this.storage.journal.record(
      selector.sessionId!,
      { type: 'message_end', message },
      {},
      (tx, event) => this.projectMessage(tx, selector, event),
    );

    this.embeddingIndex.enqueue();

    return (await this.getMessage(selector, record.messageId!))!;
  }

  async projectMessage(
    transaction: Transaction,
    selector: SessionSelector,
    record: RuntimeRecord,
  ): Promise<void> {
    if (record.event.type !== 'message_end') {
      return;
    }

    const messageId = record.messageId!;
    const message = record.event.message;
    const projectedChunks = chunkSearchText(messageToSearchText(message));
    const updatedAt = new Date(record.timestamp);

    const existing = await transaction
      .select({ id: sessionMessageLinks.id })
      .from(sessionMessageLinks)
      .where(eq(sessionMessageLinks.id, messageId));

    if (existing.length) {
      return;
    }

    const [counter] = await transaction
      .update(sessions)
      .set({ nextMessageSeq: sql`${sessions.nextMessageSeq} + 1`, updatedAt })
      .where(sessionCondition(selector))
      .returning({ nextMessageSeq: sessions.nextMessageSeq });

    if (!counter) {
      throw new SessionNotFoundError();
    }

    const seq = counter.nextMessageSeq - 1;

    const [messageRow] = await transaction
      .insert(sessionMessageLinks)
      .values({
        id: messageId,
        sessionId: selector.sessionId!,
        seq,
        eventId: record.id,
        createdAt: updatedAt,
      })
      .returning();

    if (!messageRow) {
      throw new SessionNotFoundError('消息写入失败');
    }

    if (!projectedChunks.length) {
      return;
    }

    const chunks = await transaction
      .insert(retrievalChunks)
      .values(
        projectedChunks.map((chunk, chunkIndex) => ({
          id: crypto.randomUUID(),
          sessionId: selector.sessionId!,
          messageId,
          messageSeq: seq,
          chunkIndex,
          content: chunk.content,
          searchText: chunk.searchText,
          tokenText: this.toTokenText(chunk.searchText),
          createdAt: updatedAt,
        })),
      )
      .returning({ id: retrievalChunks.id });

    await this.embeddingIndex.addPending(
      transaction,
      chunks.map(chunk => chunk.id),
    );

    return;
  }

  async getMessage(selector: SessionSelector, messageId: string): Promise<SessionMessage | null> {
    const [row] = await this.db
      .select()
      .from(sessionMessages)
      .where(and(eq(sessionMessages.id, messageId), messageCondition(selector)))
      .limit(1);

    return row ? materializeMessage(row) : null;
  }

  async getMessages(
    selector: SessionSelector,
    options: SessionMessageListOptions = {},
  ): Promise<SessionMessage[]> {
    const afterSeq = integerOption(options.afterSeq ?? 0, 'afterSeq', 0, Number.MAX_SAFE_INTEGER);

    if (options.limit !== undefined) {
      integerOption(options.limit, 'limit');
    }

    let query = this.db
      .select()
      .from(sessionMessages)
      .where(and(messageCondition(selector), gt(sessionMessages.seq, afterSeq)))
      .orderBy(asc(sessionMessages.seq))
      .$dynamic();

    if (options.limit !== undefined) {
      query = query.limit(options.limit);
    }

    return (await query).map(materializeMessage);
  }

  async getMessagesRange(
    selector: SessionSelector,
    fromSeq: number,
    toSeq: number,
  ): Promise<SessionMessage[]> {
    integerOption(fromSeq, 'fromSeq', 1, Number.MAX_SAFE_INTEGER);
    integerOption(toSeq, 'toSeq', fromSeq, Number.MAX_SAFE_INTEGER);

    const rows = await this.db
      .select()
      .from(sessionMessages)
      .where(and(messageCondition(selector), between(sessionMessages.seq, fromSeq, toSeq)))
      .orderBy(asc(sessionMessages.seq));

    return rows.map(materializeMessage);
  }

  async appendCompaction(
    selector: SessionSelector,
    input: AppendCompactionInput,
  ): Promise<SessionCompaction> {
    if (!input.summary.trim()) {
      throw new SessionValidationError('压缩摘要不能为空');
    }

    integerOption(input.throughSeq, 'throughSeq', 1, Number.MAX_SAFE_INTEGER);

    return this.db.transaction(async transaction => {
      const [session] = await transaction
        .update(sessions)
        .set({ nextMessageSeq: sql`${sessions.nextMessageSeq}` })
        .where(sessionCondition(selector))
        .returning({ nextMessageSeq: sessions.nextMessageSeq });

      if (!session) {
        throw new SessionNotFoundError();
      }

      if (session.nextMessageSeq === 1) {
        throw new SessionValidationError('空 Session 不能压缩');
      }

      if (input.throughSeq >= session.nextMessageSeq) {
        throw new SessionValidationError(
          `throughSeq ${input.throughSeq} 超过最后一条消息序号 ${session.nextMessageSeq - 1}`,
        );
      }

      const [latest] = await transaction
        .select()
        .from(sessionCompactions)
        .where(eq(sessionCompactions.sessionId, selector.sessionId!))
        .orderBy(desc(sessionCompactions.throughSeq))
        .limit(1);

      if (
        input.expectedThroughSeq !== undefined &&
        input.expectedThroughSeq !== (latest?.throughSeq ?? 0)
      ) {
        throw new SessionCompactionConflictError();
      }

      if (latest && input.throughSeq <= latest.throughSeq) {
        throw new SessionCompactionConflictError(
          `压缩边界必须前进：previous=${latest.throughSeq}, next=${input.throughSeq}`,
        );
      }

      const [row] = await transaction
        .insert(sessionCompactions)
        .values({
          id: crypto.randomUUID(),
          sessionId: selector.sessionId!,
          throughSeq: input.throughSeq,
          summary: input.summary,
        })
        .returning();

      if (!row) {
        throw new SessionNotFoundError('压缩摘要写入失败');
      }

      return materializeCompaction(row);
    });
  }

  async getLatestCompaction(selector: SessionSelector): Promise<SessionCompaction | null> {
    const sessionIds = this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(sessionCondition(selector));

    const [row] = await this.db
      .select()
      .from(sessionCompactions)
      .where(inArray(sessionCompactions.sessionId, sessionIds))
      .orderBy(desc(sessionCompactions.throughSeq))
      .limit(1);

    return row ? materializeCompaction(row) : null;
  }

  async getLastMessage(selector: SessionSelector): Promise<SessionMessage | null> {
    const [row] = await this.db
      .select()
      .from(sessionMessages)
      .where(messageCondition(selector))
      .orderBy(desc(sessionMessages.seq))
      .limit(1);

    return row ? materializeMessage(row) : null;
  }

  async rebuildChunks(selector: SessionSelector = {}): Promise<void> {
    await this.db.transaction(async transaction => {
      await transaction.delete(retrievalChunks).where(chunkCondition(selector));

      const sourceRows = await transaction
        .select()
        .from(sessions)
        .where(sessionCondition(selector));

      for (const row of sourceRows) {
        await transaction
          .update(sessions)
          .set({ sourceTokenText: this.toTokenText(row.sources.join('\n')) })
          .where(eq(sessions.id, row.id));
      }

      const messages = await transaction
        .select()
        .from(sessionMessages)
        .where(messageCondition(selector))
        .orderBy(asc(sessionMessages.sessionId), asc(sessionMessages.seq));

      for (const row of messages) {
        const projectedChunks = chunkSearchText(messageToSearchText(row.message));

        if (!projectedChunks.length) {
          continue;
        }

        const chunks = await transaction
          .insert(retrievalChunks)
          .values(
            projectedChunks.map((chunk, chunkIndex) => ({
              id: crypto.randomUUID(),
              sessionId: row.sessionId,
              messageId: row.id,
              messageSeq: row.seq,
              chunkIndex,
              content: chunk.content,
              searchText: chunk.searchText,
              tokenText: this.toTokenText(chunk.searchText),
              createdAt: row.createdAt,
            })),
          )
          .returning({ id: retrievalChunks.id });

        await this.embeddingIndex.addPending(
          transaction,
          chunks.map(chunk => chunk.id),
        );
      }
    });

    this.embeddingIndex.enqueue();
  }

  private toTokenText(text: string): string {
    return this.tokenize(normalizeSearchText(text))
      .map(normalizeSearchText)
      .filter(Boolean)
      .join(' ');
  }
}

export function materializeSession(row: SessionRow): SessionInfo {
  return {
    id: row.id,
    spaceId: row.spaceId,
    title: row.title ?? undefined,
    sources: [...row.sources],
    messageCount: row.nextMessageSeq - 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeTitle(title: string | undefined) {
  if (title === undefined) {
    return undefined;
  }

  const value = title.trim();

  if (!value) {
    throw new SessionValidationError('Session title 不能为空');
  }

  return value;
}

export function materializeMessage(row: MessageRow): SessionMessage {
  return {
    id: row.id,
    sessionId: row.sessionId,
    seq: row.seq,
    message: structuredClone(row.message),
    createdAt: row.createdAt,
  };
}

function materializeCompaction(row: CompactionRow): SessionCompaction {
  return {
    id: row.id,
    sessionId: row.sessionId,
    throughSeq: row.throughSeq,
    summary: row.summary,
    createdAt: row.createdAt,
  };
}
