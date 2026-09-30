import type { VectorIndex } from '@cieljs/vector';
import { and, asc, desc, eq, lt } from 'drizzle-orm';

import type { Database, Transaction } from './database.ts';
import {
  MemoryAccessError,
  MemoryArchivedError,
  MemoryConflictError,
  MemoryNotFoundError,
  MemoryValidationError,
} from './errors.ts';
import { filterCondition, type MemorySelector } from './query.ts';
import { memories, memoryChunks, memoryRevisions } from './schema.ts';
import { chunkText, normalizeSearchText } from './search.ts';
import type {
  MemoryEntry,
  MemoryHistoryOptions,
  MemoryListOptions,
  MemoryReadOptions,
  MemoryRevision,
  ScopedRememberInput,
  UpdateMemoryInput,
} from './types.ts';
import {
  assertContent,
  assertDate,
  assertKind,
  assertTimestamp,
  integerOption,
  normalizeSources,
} from './validation.ts';

type MemoryRow = typeof memories.$inferSelect;
type RevisionRow = typeof memoryRevisions.$inferSelect;

export class MemoryRepository {
  constructor(
    private readonly db: Database,
    private readonly embeddingIndex: VectorIndex,
    private readonly timeZone: string,
    private readonly tokenize: (text: string) => string[],
  ) {}

  getDate(at = new Date()): string {
    assertTimestamp(at);

    const parts = new Intl.DateTimeFormat('en', {
      timeZone: this.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(at);

    const part = (type: string) => parts.find(item => item.type === type)!.value;

    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  async remember(selector: MemorySelector, input: ScopedRememberInput): Promise<MemoryEntry> {
    this.validateRemember(selector, input);

    const occurredAt = input.occurredAt ?? new Date();
    const date = input.layer === 'space.daily' ? (input.date ?? this.getDate(occurredAt)) : null;
    const kind = input.kind ?? (input.layer === 'space.daily' ? 'event' : 'fact');
    const sources = normalizeSources(input.sources ?? []);
    const id = crypto.randomUUID();
    const createdAt = new Date();

    const result = await this.db.transaction(async transaction => {
      const [memory] = await transaction
        .insert(memories)
        .values({
          id,
          layer: input.layer,
          spaceId: selector.spaceId ?? null,
          date,
          createdAt,
          updatedAt: createdAt,
        })
        .returning();

      const [revision] = await transaction
        .insert(memoryRevisions)
        .values({
          memoryId: id,
          revision: 1,
          kind,
          content: input.content,
          sources,
          sourceSearchText: normalizeSearchText(sources.join('\n')),
          sourceTokenText: this.toTokenText(sources.join('\n')),
          occurredAt,
          expiresAt: input.expiresAt,
          createdAt,
        })
        .returning();

      await this.replaceChunks(transaction, id, 1, input.content);

      return materializeMemory(memory!, revision!);
    });

    this.embeddingIndex.enqueue();

    return result;
  }

  async get(
    selector: MemorySelector,
    id: string,
    options: MemoryReadOptions = {},
  ): Promise<MemoryEntry | null> {
    const rows = await this.currentRows(selector, options, eq(memories.id, id));

    return rows[0] ? materializeMemory(rows[0].memory, rows[0].revision) : null;
  }

  async list(
    selector: MemorySelector,
    options: MemoryListOptions & { dateFrom?: string; dateTo?: string } = {},
  ): Promise<MemoryEntry[]> {
    const limit = integerOption(options.limit ?? 50, 'limit');
    const offset = integerOption(options.offset ?? 0, 'offset', 0, Number.MAX_SAFE_INTEGER);

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
      .where(filterCondition(selector, options))
      .orderBy(desc(memoryRevisions.occurredAt), asc(memories.id))
      .limit(limit)
      .offset(offset);

    return rows.map(row => materializeMemory(row.memory, row.revision));
  }

  async update(
    selector: MemorySelector,
    id: string,
    input: UpdateMemoryInput,
  ): Promise<MemoryEntry> {
    this.validateUpdate(input);

    const result = await this.db.transaction(async transaction => {
      const current = await this.getCurrentForMutation(transaction, selector, id);
      this.assertMutable(current.memory, input.expectedRevision);

      const revisionNumber = current.memory.currentRevision + 1;

      const sources =
        input.sources === undefined ? current.revision.sources : normalizeSources(input.sources);

      const content = input.content ?? current.revision.content;
      const updatedAt = new Date();

      const [head] = await transaction
        .update(memories)
        .set({ currentRevision: revisionNumber, updatedAt })
        .where(
          and(
            eq(memories.id, id),
            eq(memories.status, 'active'),
            eq(memories.currentRevision, input.expectedRevision),
          ),
        )
        .returning();

      if (!head) {
        throw new MemoryConflictError();
      }

      const [revision] = await transaction
        .insert(memoryRevisions)
        .values({
          memoryId: id,
          revision: revisionNumber,
          kind: input.kind ?? current.revision.kind,
          content,
          sources,
          sourceSearchText: normalizeSearchText(sources.join('\n')),
          sourceTokenText: this.toTokenText(sources.join('\n')),
          occurredAt: current.revision.occurredAt,
          expiresAt: input.expiresAt === undefined ? current.revision.expiresAt : input.expiresAt,
          createdAt: updatedAt,
        })
        .returning();

      await this.replaceChunks(transaction, id, revisionNumber, content);

      return materializeMemory(head, revision!);
    });

    this.embeddingIndex.enqueue();

    return result;
  }

  async archive(selector: MemorySelector, id: string, expectedRevision: number): Promise<void> {
    integerOption(expectedRevision, 'expectedRevision', 1, 2147483646);

    await this.db.transaction(async transaction => {
      const current = await this.getCurrentForMutation(transaction, selector, id);
      this.assertMutable(current.memory, expectedRevision);

      const [archived] = await transaction
        .update(memories)
        .set({ status: 'archived', archivedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(memories.id, id),
            eq(memories.status, 'active'),
            eq(memories.currentRevision, expectedRevision),
          ),
        )
        .returning({ id: memories.id });

      if (!archived) {
        throw new MemoryConflictError();
      }
    });
  }

  async history(
    selector: MemorySelector,
    id: string,
    options: MemoryHistoryOptions = {},
  ): Promise<MemoryRevision[]> {
    await this.assertReadableIdentity(selector, id);
    const limit = integerOption(options.limit ?? 20, 'limit');

    if (options.beforeRevision !== undefined) {
      integerOption(options.beforeRevision, 'beforeRevision', 1, 2147483647);
    }

    const rows = await this.db
      .select()
      .from(memoryRevisions)
      .where(
        and(
          eq(memoryRevisions.memoryId, id),
          options.beforeRevision === undefined
            ? undefined
            : lt(memoryRevisions.revision, options.beforeRevision),
        ),
      )
      .orderBy(desc(memoryRevisions.revision))
      .limit(limit);

    return rows.map(materializeRevision);
  }

  async getRevision(
    selector: MemorySelector,
    id: string,
    revision: number,
  ): Promise<MemoryRevision | null> {
    integerOption(revision, 'revision', 1, 2147483647);
    await this.assertReadableIdentity(selector, id);

    const [row] = await this.db
      .select()
      .from(memoryRevisions)
      .where(and(eq(memoryRevisions.memoryId, id), eq(memoryRevisions.revision, revision)));

    return row ? materializeRevision(row) : null;
  }

  async rebuildChunks(): Promise<void> {
    await this.db.transaction(async transaction => {
      await transaction.delete(memoryChunks);

      const rows = await transaction
        .select({ memory: memories, revision: memoryRevisions })
        .from(memories)
        .innerJoin(
          memoryRevisions,
          and(
            eq(memoryRevisions.memoryId, memories.id),
            eq(memoryRevisions.revision, memories.currentRevision),
          ),
        );

      const revisions = await transaction.select().from(memoryRevisions);

      for (const revision of revisions) {
        await transaction
          .update(memoryRevisions)
          .set({ sourceTokenText: this.toTokenText(revision.sources.join('\n')) })
          .where(
            and(
              eq(memoryRevisions.memoryId, revision.memoryId),
              eq(memoryRevisions.revision, revision.revision),
            ),
          );
      }

      for (const row of rows) {
        await this.replaceChunks(
          transaction,
          row.memory.id,
          row.revision.revision,
          row.revision.content,
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

  private currentRows(
    selector: MemorySelector,
    options: MemoryReadOptions,
    condition?: ReturnType<typeof eq>,
  ) {
    return this.db
      .select({ memory: memories, revision: memoryRevisions })
      .from(memories)
      .innerJoin(
        memoryRevisions,
        and(
          eq(memoryRevisions.memoryId, memories.id),
          eq(memoryRevisions.revision, memories.currentRevision),
        ),
      )
      .where(and(filterCondition(selector, options), condition));
  }

  private async getCurrentForMutation(
    transaction: Transaction,
    selector: MemorySelector,
    id: string,
  ): Promise<{ memory: MemoryRow; revision: RevisionRow }> {
    const [identity] = await transaction.select().from(memories).where(eq(memories.id, id));

    if (!identity) {
      throw new MemoryNotFoundError();
    }

    if (!matchesSelector(identity, selector)) {
      throw new MemoryAccessError();
    }

    const [revision] = await transaction
      .select()
      .from(memoryRevisions)
      .where(
        and(
          eq(memoryRevisions.memoryId, id),
          eq(memoryRevisions.revision, identity.currentRevision),
        ),
      );

    if (!revision) {
      throw new MemoryNotFoundError('记忆当前版本不存在');
    }

    return { memory: identity, revision };
  }

  private async assertReadableIdentity(selector: MemorySelector, id: string): Promise<void> {
    const [row] = await this.db.select().from(memories).where(eq(memories.id, id));

    if (!row) {
      throw new MemoryNotFoundError();
    }

    if (!matchesSelector(row, selector)) {
      throw new MemoryAccessError();
    }
  }

  private assertMutable(memory: MemoryRow, expectedRevision: number): void {
    if (memory.status === 'archived') {
      throw new MemoryArchivedError();
    }

    if (memory.currentRevision !== expectedRevision) {
      throw new MemoryConflictError();
    }
  }

  private validateRemember(selector: MemorySelector, input: ScopedRememberInput): void {
    assertContent(input.content);
    assertTimestamp(input.occurredAt ?? new Date());

    if (input.expiresAt) {
      assertTimestamp(input.expiresAt);
    }

    if (!selector.layers.includes(input.layer)) {
      throw new MemoryAccessError('记忆层级不属于当前入口');
    }

    if (input.layer !== 'space.daily' && input.date !== undefined) {
      throw new MemoryValidationError('长期记忆不能设置日期');
    }

    if (input.date !== undefined) {
      assertDate(input.date);
    }

    if (input.kind !== undefined) {
      assertKind(input.kind);
    }

    normalizeSources(input.sources ?? []);
  }

  private validateUpdate(input: UpdateMemoryInput): void {
    integerOption(input.expectedRevision, 'expectedRevision', 1, 2147483646);

    const hasPatch = [input.content, input.kind, input.expiresAt, input.sources].some(
      value => value !== undefined,
    );

    if (!hasPatch) {
      throw new MemoryValidationError('至少提供一个要更新的字段');
    }

    if (input.content !== undefined) {
      assertContent(input.content);
    }

    if (input.kind !== undefined) {
      assertKind(input.kind);
    }

    if (input.expiresAt) {
      assertTimestamp(input.expiresAt);
    }

    if (input.sources !== undefined) {
      normalizeSources(input.sources);
    }
  }

  private async replaceChunks(
    transaction: Transaction,
    memoryId: string,
    revision: number,
    content: string,
  ): Promise<void> {
    await transaction.delete(memoryChunks).where(eq(memoryChunks.memoryId, memoryId));

    const chunks = chunkText(content).map((chunk, position) => ({
      id: crypto.randomUUID(),
      memoryId,
      revision,
      position,
      content: chunk,
      searchText: normalizeSearchText(chunk),
      tokenText: this.tokenize(normalizeSearchText(chunk))
        .map(normalizeSearchText)
        .filter(Boolean)
        .join(' '),
    }));

    await transaction.insert(memoryChunks).values(chunks);

    await this.embeddingIndex.addPending(
      transaction,
      chunks.map(chunk => chunk.id),
    );
  }
}

export function materializeMemory(memory: MemoryRow, revision: RevisionRow): MemoryEntry {
  return {
    id: memory.id,
    layer: memory.layer,
    spaceId: memory.spaceId,
    date: memory.date,
    status: memory.status,
    revision: revision.revision,
    kind: revision.kind,
    content: revision.content,
    sources: [...revision.sources],
    occurredAt: revision.occurredAt,
    expiresAt: revision.expiresAt,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  } as MemoryEntry;
}

export function materializeRevision(revision: RevisionRow): MemoryRevision {
  return {
    memoryId: revision.memoryId,
    revision: revision.revision,
    kind: revision.kind,
    content: revision.content,
    sources: [...revision.sources],
    occurredAt: revision.occurredAt,
    expiresAt: revision.expiresAt,
    createdAt: revision.createdAt,
  };
}

function matchesSelector(memory: MemoryRow, selector: MemorySelector): boolean {
  const isMatchingLayer = selector.layers.includes(memory.layer);
  const isMatchingSpace = selector.spaceId === undefined || memory.spaceId === selector.spaceId;

  return isMatchingLayer && isMatchingSpace;
}
