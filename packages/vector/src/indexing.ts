import type { Database, Transaction } from '@cieljs/storage';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';

import { vectorEntries } from './schema.ts';
import type { VectorService } from './service.ts';

export interface VectorSource {
  namespace: string;
  table: PgTable;
  id: AnyPgColumn;
  content: AnyPgColumn;
  condition?: (sessionId?: string) => SQL | undefined;
}

export class VectorIndex {
  private indexing = Promise.resolve();
  constructor(
    private readonly db: Database,
    private readonly provider: VectorService | undefined,
    private readonly source: VectorSource,
    private readonly onError?: (error: unknown) => void,
  ) {}

  async prepare(reset = false, sessionId?: string) {
    if (!this.provider) {
      return;
    }

    const rows = await this.db
      .select({ id: this.source.id })
      .from(this.source.table)
      .where(this.source.condition?.(sessionId));

    await this.db.transaction(async tx => {
      for (let start = 0; start < rows.length; start += 500) {
        const ids = rows.slice(start, start + 500).map(row => String(row.id));
        await this.addPending(tx, ids);

        await tx
          .update(vectorEntries)
          .set({ status: 'pending', cacheKey: null, error: null })
          .where(
            and(
              this.condition(),
              inArray(vectorEntries.chunkId, ids),
              reset ? undefined : eq(vectorEntries.status, 'failed'),
            ),
          );
      }

      // 清理被业务删除或重新切块的关联，不删除其他业务仍可复用的缓存。
      await tx
        .delete(vectorEntries)
        .where(
          and(
            this.condition(),
            sql`${vectorEntries.chunkId} NOT IN (SELECT ${this.source.id} FROM ${this.source.table})`,
          ),
        );
    });
  }

  async addPending(tx: Transaction, ids: string[]) {
    if (!this.provider || !ids.length) {
      return;
    }

    await tx
      .insert(vectorEntries)
      .values(
        ids.map(chunkId => ({
          namespace: this.source.namespace,
          chunkId,
          model: this.provider!.model,
          dimensions: this.provider!.dimensions,
        })),
      )
      .onConflictDoNothing();
  }

  enqueue() {
    if (!this.provider) {
      return;
    }

    this.indexing = this.indexing
      .then(() => this.indexPending())
      .catch(error => this.reportError(error));
  }

  async rebuild(sessionId?: string) {
    await this.prepare(true, sessionId);
    this.enqueue();
  }

  async retry() {
    await this.prepare();
    this.enqueue();
  }

  async flush() {
    let pending: Promise<void>;

    do {
      pending = this.indexing;
      await pending;
    } while (pending !== this.indexing);
  }

  get model() {
    return this.provider
      ? {
          model: this.provider.model,
          dimensions: this.provider.dimensions,
          namespace: this.source.namespace,
        }
      : undefined;
  }

  async embedQuery(query: string, signal?: AbortSignal) {
    return this.provider ? this.provider.embed(query, { purpose: 'query', signal }) : null;
  }

  async status() {
    const result = { pending: 0, ready: 0, failed: 0 };

    if (!this.provider) {
      return result;
    }

    const rows = await this.db
      .select({ status: vectorEntries.status, count: sql<number>`count(*)::integer` })
      .from(vectorEntries)
      .where(this.condition())
      .groupBy(vectorEntries.status);

    for (const row of rows) {
      result[row.status] = row.count;
    }

    return result;
  }

  reportError(error: unknown) {
    if (!this.onError) {
      console.warn(`[vector:${this.source.namespace}] 索引或检索失败`, error);

      return;
    }

    try {
      this.onError(error);
    } catch (callbackError) {
      console.warn(`[vector:${this.source.namespace}] 错误回调失败`, callbackError);
    }
  }

  private condition() {
    return and(
      eq(vectorEntries.namespace, this.source.namespace),
      eq(vectorEntries.model, this.provider!.model),
    )!;
  }
  private async indexPending() {
    const provider = this.provider!;

    while (true) {
      const rows = await this.db
        .select({ id: this.source.id, content: this.source.content })
        .from(vectorEntries)
        .innerJoin(this.source.table, eq(this.source.id, vectorEntries.chunkId))
        .where(and(this.condition(), eq(vectorEntries.status, 'pending')))
        .orderBy(asc(this.source.id))
        .limit(provider.batchSize);

      if (!rows.length) {
        return;
      }

      try {
        await provider.embedBatch(
          rows.map(row => String(row.content)),
          { purpose: 'document' },
        );

        await this.db.transaction(async tx => {
          for (const row of rows) {
            const condition = and(
              this.condition(),
              eq(vectorEntries.chunkId, String(row.id)),
              eq(vectorEntries.status, 'pending'),
            );

            await tx
              .update(vectorEntries)
              .set({
                cacheKey: provider.key(String(row.content), 'document'),
                status: 'ready',
                error: null,
              })
              .where(condition);
          }
        });
      } catch (error) {
        const chunkIds = rows.map(row => String(row.id));

        const condition = and(
          this.condition(),
          inArray(vectorEntries.chunkId, chunkIds),
          eq(vectorEntries.status, 'pending'),
        );

        await this.db
          .update(vectorEntries)
          .set({ status: 'failed', cacheKey: null, error: String(error) })
          .where(condition);

        this.reportError(error);
      }
    }
  }
}
