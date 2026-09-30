import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';

import { RuntimeJournal } from './journal.ts';

export type Database = ReturnType<typeof drizzle>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface StorageModule {
  id: string;
  migrations: readonly { id: string; sql: string }[];
}

export interface StorageOptions {
  dataDir: string;
  modules?: readonly StorageModule[];
}

export class Storage implements AsyncDisposable {
  readonly journal: RuntimeJournal;
  private closing?: Promise<void>;
  private readonly modules = new Set<string>();

  private constructor(
    private readonly client: PGlite,
    readonly db: Database,
    private readonly checkpointOnClose: boolean,
  ) {
    this.journal = new RuntimeJournal(db);
  }

  static async open(options: StorageOptions): Promise<Storage> {
    if (!options.dataDir?.trim()) {
      throw new TypeError('Storage dataDir 不能为空');
    }

    const modules = options.modules ?? [];
    const ids = new Set<string>();

    for (const module of modules) {
      if (!/^[a-z][a-z0-9_]*$/.test(module.id) || ids.has(module.id) || module.id === 'storage') {
        throw new TypeError(`无效或重复的 Storage module: ${module.id}`);
      }

      ids.add(module.id);
    }

    const client = new PGlite(options.dataDir, { extensions: { vector, pg_trgm } });
    await using disposables = new AsyncDisposableStack();
    disposables.defer(() => client.close());
    await client.waitReady;

    await client.exec(`CREATE EXTENSION IF NOT EXISTS vector;
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
      CREATE SCHEMA IF NOT EXISTS storage;
      CREATE TABLE IF NOT EXISTS storage.events (
        id text PRIMARY KEY, sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
        session_id text NOT NULL, message_id text, record jsonb NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_session ON storage.events(session_id, sequence);`);

    const storage = new Storage(
      client,
      drizzle({ client }),
      !options.dataDir.startsWith('memory://'),
    );

    for (const module of modules) {
      await client.transaction(async tx => {
        await tx.exec(`CREATE SCHEMA IF NOT EXISTS "${module.id}";
          CREATE TABLE IF NOT EXISTS "${module.id}".__migrations (id text PRIMARY KEY, sql text NOT NULL)`);

        for (const migration of module.migrations) {
          const applied = await tx.query<{ sql: string }>(
            `SELECT sql FROM "${module.id}".__migrations WHERE id = $1`,
            [migration.id],
          );

          if (applied.rows.length) {
            if (applied.rows[0]!.sql !== migration.sql) {
              throw new Error(`迁移内容已修改: ${module.id}/${migration.id}`);
            }

            continue;
          }

          await tx.exec(migration.sql);

          await tx.query(`INSERT INTO "${module.id}".__migrations VALUES ($1, $2)`, [
            migration.id,
            migration.sql,
          ]);
        }
      });

      storage.modules.add(module.id);
    }

    disposables.move();

    return storage;
  }

  require(module: StorageModule): void {
    if (this.closing) {
      throw new Error('Storage 已关闭');
    }

    if (!this.modules.has(module.id)) {
      throw new Error(`Storage 未注册模块: ${module.id}`);
    }
  }

  /**
   * 主动推进 checkpoint。PGlite 没有后台 checkpointer，进程被强杀（dev 重启、Ctrl+C）
   * 时下次启动必须重放「上个 checkpoint 之后」的全部 WAL：调用方按周期推进即可把
   * 恢复窗口限制在一个周期内，而不是整段运行历史。
   */
  async checkpoint(): Promise<void> {
    if (this.closing) {
      return;
    }

    await this.client.exec('CHECKPOINT');
  }

  close(): Promise<void> {
    this.closing ??= this.closeResources();

    return this.closing;
  }

  [Symbol.asyncDispose]() {
    return this.close();
  }

  private async closeResources() {
    await using disposables = new AsyncDisposableStack();
    disposables.defer(() => this.client.close());
    await this.journal.close();

    if (this.checkpointOnClose) {
      // 所有写入排空后再推进最终 checkpoint，正常退出不把 WAL 恢复留给下次启动。
      await this.client.exec('CHECKPOINT');
    }
  }
}
