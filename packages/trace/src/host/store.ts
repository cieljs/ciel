import { serialize, deserialize } from 'node:v8';

import { sql, type Storage, type StorageModule, type Transaction } from '@cieljs/storage';

export const traceStorage: StorageModule = {
  id: 'trace',
  migrations: [
    {
      id: '0001',
      sql: `
 CREATE TABLE trace.records (
   id text PRIMARY KEY,
   category text NOT NULL,
   sequence bigint NOT NULL,
   run_id text,
   value bytea NOT NULL
 );
 CREATE INDEX records_order ON trace.records(category, sequence);
 CREATE INDEX records_run ON trace.records(run_id, category, sequence);
`,
    },
    {
      id: '0002',
      sql: `
 ALTER TABLE trace.records ADD COLUMN session_id text;
 CREATE INDEX records_session ON trace.records(session_id, category, sequence);
`,
    },
  ],
};

interface StoredRecord {
  id: string;
  category: string;
  sequence: number;
  bytes: Uint8Array;
  value: unknown;
  runId?: string;
  sessionId?: string;
}

export class TraceStore {
  private static readonly projectionStateId = 'trace:projection-state';
  private pending = Promise.resolve();
  private readonly writes = new Map<string, StoredRecord>();
  private readonly transientValues = new Map<string, unknown>();
  private error: unknown;
  private constructor(
    private readonly storage: Storage,
    private table = 'trace.records',
  ) {
    storage.require(traceStorage);
  }

  static async open(storage: Storage) {
    return new TraceStore(storage);
  }

  async sequence() {
    const table = sql.raw(this.table);

    const result = await this.storage.db.execute<{ n: string }>(
      sql`SELECT COALESCE(MAX(sequence), 0) AS n
          FROM ${table}
          WHERE category = 'entry'`,
    );

    return Number(result.rows[0]!.n);
  }
  async projectionState<T>() {
    await this.flush();
    const table = sql.raw(this.table);

    const result = await this.storage.db.execute<{ value: Uint8Array }>(
      sql`SELECT value FROM ${table}
          WHERE id = ${TraceStore.projectionStateId}
            AND category = 'projection_state'`,
    );

    const row = result.rows[0];

    return row ? (JSON.parse(Buffer.from(row.value).toString('utf8')) as T) : undefined;
  }
  saveProjectionState(sequence: number, value: unknown) {
    this.write(
      TraceStore.projectionStateId,
      'projection_state',
      sequence,
      Buffer.from(JSON.stringify(value)),
      value,
    );
  }
  put(
    id: string,
    category: string,
    sequence: number,
    value: unknown,
    runId?: string,
    sessionId?: string,
  ) {
    this.transientValues.delete(id);
    const stored = snapshot(value);
    const bytes = serialize(stored);

    this.write(id, category, sequence, bytes, stored, runId, sessionId);
  }
  putTransient(id: string, value: unknown) {
    this.transientValues.set(id, snapshot(value));
  }
  private write(
    id: string,
    category: string,
    sequence: number,
    bytes: Uint8Array,
    value: unknown,
    runId?: string,
    sessionId?: string,
  ) {
    this.writes.set(id, { id, category, sequence, bytes, value, runId, sessionId });
  }
  async get<T>(id: string): Promise<T | undefined> {
    if (this.transientValues.has(id)) {
      return this.transientValues.get(id) as T;
    }

    const pending = this.writes.get(id);

    if (pending && pending.category !== 'message_reference') {
      return pending.value as T;
    }

    if (pending) {
      return this.message<T>(pending.value);
    }

    // 同一投影批次里其他记录尚未落盘不影响当前 ID 的旧值，避免一次 get 拆散整个事务。
    await this.pending;
    this.throwPendingError();
    const table = sql.raw(this.table);

    const result = await this.storage.db.execute<{ value: Uint8Array; category: string }>(
      sql`SELECT category, value FROM ${table} WHERE id = ${id}`,
    );

    const row = result.rows[0];

    if (!row) {
      const event = await this.storage.db.execute<{ record: T }>(
        sql`SELECT record FROM storage.events WHERE id = ${id}`,
      );

      return event.rows[0]?.record;
    }

    const value = deserialize(row.value);

    if (row.category === 'message_reference') {
      return this.message<T>(value);
    }

    return value as T;
  }
  async list<T>(
    category: string,
    options: {
      after?: number;
      before?: number;
      limit?: number;
      runId?: string;
      sessionId?: string;
      ascending?: boolean;
    } = {},
  ): Promise<T[]> {
    await this.flush();
    const table = sql.raw(this.table);

    const result = await this.storage.db.execute<{ value: Uint8Array }>(
      sql`SELECT value FROM ${table}
          WHERE category = ${category}
            AND sequence > ${options.after ?? 0}
            AND sequence < ${options.before ?? Number.MAX_SAFE_INTEGER}
            AND (${options.runId ?? null}::text IS NULL OR run_id = ${options.runId ?? null})
            AND (${options.sessionId ?? null}::text IS NULL OR session_id = ${options.sessionId ?? null})
          ORDER BY sequence ${sql.raw(options.ascending ? 'ASC' : 'DESC')}
          LIMIT ${options.limit ?? 100}`,
    );

    const rows = options.ascending ? result.rows : result.rows.reverse();

    return rows.map(row => deserialize(row.value) as T);
  }
  async flush() {
    while (this.writes.size) {
      const writes = [...this.writes.values()];
      this.writes.clear();

      this.pending = this.pending
        .then(() =>
          this.storage.db.transaction(async tx => {
            for (const record of writes) {
              await this.persist(tx, record);
            }
          }),
        )
        .catch(error => {
          this.error ??= error;
        });

      await this.pending;
    }

    this.throwPendingError();
  }

  async createRebuild() {
    await this.flush();

    await this.storage.db.transaction(async tx => {
      await tx.execute(sql`DROP TABLE IF EXISTS trace.records_rebuild`);

      await tx.execute(sql`
        CREATE TABLE trace.records_rebuild (
          id text PRIMARY KEY,
          category text NOT NULL,
          sequence bigint NOT NULL,
          run_id text,
          value bytea NOT NULL,
          session_id text
        )
      `);

      await tx.execute(sql`
        CREATE INDEX records_rebuild_order
        ON trace.records_rebuild(category, sequence)
      `);

      await tx.execute(sql`
        CREATE INDEX records_rebuild_run
        ON trace.records_rebuild(run_id, category, sequence)
      `);

      await tx.execute(sql`
        CREATE INDEX records_rebuild_session
        ON trace.records_rebuild(session_id, category, sequence)
      `);
    });

    return new TraceStore(this.storage, 'trace.records_rebuild');
  }

  async activate(rebuilt: TraceStore) {
    await this.flush();
    await rebuilt.flush();

    await this.storage.db.transaction(async tx => {
      await tx.execute(sql`DROP TABLE IF EXISTS trace.records_stale`);
      await tx.execute(sql`ALTER TABLE trace.records RENAME TO records_stale`);
      await tx.execute(sql`ALTER TABLE trace.records_rebuild RENAME TO records`);
      await tx.execute(sql`DROP TABLE trace.records_stale`);
      await tx.execute(sql`ALTER INDEX trace.records_rebuild_order RENAME TO records_order`);
      await tx.execute(sql`ALTER INDEX trace.records_rebuild_run RENAME TO records_run`);
      await tx.execute(sql`ALTER INDEX trace.records_rebuild_session RENAME TO records_session`);

      await tx.execute(sql`
        ALTER TABLE trace.records RENAME CONSTRAINT records_rebuild_pkey TO records_pkey
      `);
    });

    rebuilt.table = 'trace.records';
  }

  close() {
    return this.flush();
  }

  private async persist(tx: Transaction, record: StoredRecord) {
    const table = sql.raw(this.table);

    await tx.execute(
      sql`INSERT INTO ${table} AS target
            (id, category, sequence, run_id, value, session_id)
          VALUES (${record.id}, ${record.category}, ${record.sequence}, ${record.runId ?? null},
                  ${record.bytes}, ${record.sessionId ?? null})
          ON CONFLICT (id) DO UPDATE SET
            category = EXCLUDED.category,
            sequence = EXCLUDED.sequence,
            run_id = EXCLUDED.run_id,
            value = EXCLUDED.value,
            session_id = EXCLUDED.session_id
          WHERE (target.category,
                 target.sequence,
                 target.run_id,
                 target.value,
                 target.session_id)
                IS DISTINCT FROM
                (EXCLUDED.category,
                 EXCLUDED.sequence,
                 EXCLUDED.run_id,
                 EXCLUDED.value,
                 EXCLUDED.session_id)`,
    );
  }

  private async message<T>(eventId: unknown) {
    const message = await this.storage.db.execute<{ message: T }>(
      sql`SELECT record->'event'->'message' AS message FROM storage.events WHERE id = ${eventId}`,
    );

    return message.rows[0]?.message;
  }

  private throwPendingError() {
    if (!this.error) {
      return;
    }

    const error = this.error;
    this.error = undefined;
    throw error;
  }
}

// oxlint-disable-next-line eslint/complexity -- 快照按内建容器类型递归复制，并显式处理循环引用。
function snapshot(value: unknown, seen = new Map<object, unknown>()): unknown {
  if (!value || typeof value !== 'object') {
    return typeof value === 'function' ? '[Function]' : value;
  }

  if (seen.has(value)) {
    return seen.get(value);
  }

  if (
    value instanceof Date ||
    value instanceof Error ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  ) {
    return value;
  }

  if (value instanceof Map) {
    const result = new Map();
    seen.set(value, result);

    for (const [key, item] of value) {
      result.set(snapshot(key, seen), snapshot(item, seen));
    }

    return result;
  }

  if (value instanceof Set) {
    const result = new Set();
    seen.set(value, result);

    for (const item of value) {
      result.add(snapshot(item, seen));
    }

    return result;
  }

  const result: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
  seen.set(value, result);

  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (key === 'length' && Array.isArray(result)) {
      continue;
    }

    Object.defineProperty(result, key, {
      value: 'value' in descriptor ? snapshot(descriptor.value, seen) : '[Getter / Setter]',
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  return result;
}
