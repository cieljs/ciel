import { VectorIndex } from '@cieljs/vector';
import { and, eq, sql } from 'drizzle-orm';

import type { Database } from './database.ts';
import { SessionClosedError, SessionValidationError } from './errors.ts';
import { SessionRepository } from './repository.ts';
import { SessionRetrieval } from './retrieval.ts';
import { retrievalChunks, sessions } from './schema.ts';
import { tokenizeSearchText } from './search.ts';
import { createSessionSpace, type SessionSpace } from './session-space.ts';
import { Session, type SessionServices } from './session.ts';
import { sessionStorage } from './storage-module.ts';
import type {
  FindSessionsBySourceOptions,
  SearchAllSessionsOptions,
  SessionIndexStatus,
  SessionInfo,
  SessionListOptions,
  SessionManagerOptions,
  SessionSearchHit,
  SessionSourceHit,
} from './types.ts';

export class SessionManager implements AsyncDisposable {
  private readonly namespace: string;
  private readonly embeddingIndex: VectorIndex;
  private readonly repository: SessionRepository;
  private readonly retrieval: SessionRetrieval;
  private readonly services: SessionServices;
  private readonly compactions = new Map<string, Promise<void>>();
  private readonly operations = new Set<Promise<unknown>>();
  private closing: Promise<void> | undefined;

  private constructor(db: Database, options: SessionManagerOptions) {
    this.namespace = options.namespace;
    const tokenize = options.tokenize ?? tokenizeSearchText;

    this.embeddingIndex = new VectorIndex(
      db,
      options.vectors,
      {
        namespace: `session:${options.namespace}`,
        table: retrievalChunks,
        id: retrievalChunks.id,
        content: retrievalChunks.content,
        condition: sessionId =>
          and(
            sql`${retrievalChunks.sessionId} IN (SELECT ${sessions.id} FROM ${sessions} WHERE ${sessions.namespace} = ${options.namespace})`,
            sessionId ? eq(retrievalChunks.sessionId, sessionId) : undefined,
          ),
      },
      options.onIndexError,
    );

    this.repository = new SessionRepository(db, this.embeddingIndex, options.storage, tokenize);
    this.retrieval = new SessionRetrieval(db, this.embeddingIndex, tokenize);

    this.services = {
      namespace: options.namespace,
      storage: options.storage,
      repository: this.repository,
      retrieval: this.retrieval,
      embeddingIndex: this.embeddingIndex,
      compactions: this.compactions,
      operate: this.operate.bind(this),
    };
  }

  static async open(options: SessionManagerOptions): Promise<SessionManager> {
    options.storage.require(sessionStorage);

    if (!options.namespace?.trim()) {
      throw new SessionValidationError('namespace 不能为空');
    }

    const manager = new SessionManager(options.storage.db, options);
    await manager.embeddingIndex.prepare();
    manager.embeddingIndex.enqueue();

    return manager;
  }

  space(spaceId: string): SessionSpace {
    this.assertOpen();

    if (!spaceId?.trim()) {
      throw new SessionValidationError('spaceId 不能为空');
    }

    return createSessionSpace(this.services, spaceId);
  }

  getSessionAcrossSpaces(id: string): Promise<Session | null> {
    return this.operate(async () => {
      const info = await this.repository.getInfo({ namespace: this.namespace, sessionId: id });

      return info ? new Session(this.services, info.id, info.spaceId) : null;
    });
  }

  list(options: SessionListOptions = {}): Promise<SessionInfo[]> {
    return this.operate(() => this.repository.list({ namespace: this.namespace }, options));
  }

  searchAll(query: string, options: SearchAllSessionsOptions = {}): Promise<SessionSearchHit[]> {
    return this.operate(() => this.retrieval.search({ namespace: this.namespace }, query, options));
  }

  findSessionsBySource(
    query: string,
    options: FindSessionsBySourceOptions = {},
  ): Promise<SessionSourceHit[]> {
    return this.operate(() =>
      this.retrieval.findBySource({ namespace: this.namespace }, query, options),
    );
  }

  getIndexStatus(): Promise<SessionIndexStatus> {
    return this.operate(() => this.embeddingIndex.status());
  }

  flushIndexes(): Promise<void> {
    return this.operate(() => this.embeddingIndex.flush());
  }

  retryIndexes(): Promise<void> {
    return this.operate(() => this.embeddingIndex.retry());
  }

  rebuildIndexes(): Promise<void> {
    return this.operate(async () => {
      await this.embeddingIndex.flush();
      await this.repository.rebuildChunks({ namespace: this.namespace });
      await this.embeddingIndex.flush();
    });
  }

  close(): Promise<void> {
    this.closing ??= this.closeResources();

    return this.closing;
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  private async closeResources(): Promise<void> {
    await Promise.allSettled(this.operations);
    await Promise.allSettled(this.compactions.values());
    await this.embeddingIndex.flush();
  }

  private assertOpen(): void {
    if (this.closing) {
      throw new SessionClosedError();
    }
  }

  private operate<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) {
      return Promise.reject(new SessionClosedError());
    }

    const result = Promise.resolve().then(operation);
    this.operations.add(result);

    void result.then(
      () => this.operations.delete(result),
      () => this.operations.delete(result),
    );

    return result;
  }
}
