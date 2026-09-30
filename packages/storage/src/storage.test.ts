import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { expect, test } from 'vite-plus/test';

import { Storage, type StorageModule } from './storage.ts';

test('模块迁移隔离、重开幂等，失败迁移回滚并释放数据库', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ciel-storage-'));

  const first: StorageModule = {
    id: 'first',
    migrations: [{ id: '1', sql: 'CREATE TABLE first.items (id text PRIMARY KEY)' }],
  };

  const second: StorageModule = {
    id: 'second',
    migrations: [{ id: '1', sql: 'CREATE TABLE second.items (id text PRIMARY KEY)' }],
  };

  try {
    const storage = await Storage.open({ dataDir: directory, modules: [first, second] });
    await storage.db.execute(sql`INSERT INTO first.items VALUES ('first')`);
    await storage.close();

    await using reopened = await Storage.open({ dataDir: directory, modules: [second, first] });

    expect((await reopened.db.execute(sql`SELECT * FROM first.items`)).rows).toEqual([
      { id: 'first' },
    ]);

    expect((await reopened.db.execute(sql`SELECT * FROM second.items`)).rows).toEqual([]);
    await reopened.close();

    await expect(
      Storage.open({
        dataDir: directory,
        modules: [
          {
            id: 'broken',
            migrations: [{ id: '1', sql: 'CREATE TABLE broken.items (id text); INVALID SQL' }],
          },
        ],
      }),
    ).rejects.toThrow();

    await using recovered = await Storage.open({ dataDir: directory });

    expect(
      (await recovered.db.execute(sql`SELECT to_regclass('broken.items') AS name`)).rows,
    ).toEqual([{ name: null }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test('checkpoint 可随时推进，关闭后再推进是空操作', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ciel-storage-'));

  try {
    const storage = await Storage.open({ dataDir: directory });
    await storage.db.execute(sql`CREATE TABLE public.items (id text PRIMARY KEY)`);
    await storage.db.execute(sql`INSERT INTO public.items VALUES ('kept')`);
    await storage.checkpoint();
    await storage.close();
    // 关闭后周期任务可能还会打一次；不能抛出，也不能复活连接。
    await storage.checkpoint();

    await using reopened = await Storage.open({ dataDir: directory });

    expect((await reopened.db.execute(sql`SELECT * FROM public.items`)).rows).toEqual([
      { id: 'kept' },
    ]);

    await reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test('事件和投影原子提交，重复事件不会丢失后注册的投影', async () => {
  await using storage = await Storage.open({ dataDir: 'memory://' });

  const event = {
    type: 'message_end' as const,
    message: { role: 'user' as const, content: 'hello', timestamp: 1 },
  };

  const record = await storage.journal.record('session', event);

  const projected = await storage.journal.record('session', event, {}, async transaction => {
    await transaction.execute(sql`CREATE TABLE storage.projection (id text)`);
    await transaction.execute(sql`INSERT INTO storage.projection VALUES (${record.messageId!})`);
  });

  expect(projected.id).toBe(record.id);
  expect(await storage.journal.read()).toHaveLength(1);

  await expect(
    storage.journal.record('session', { type: 'agent_start' }, {}, async () => {
      throw new Error('projection failed');
    }),
  ).rejects.toThrow('projection failed');

  expect(await storage.journal.read()).toHaveLength(1);
  await expect(storage.journal.flush()).rejects.toThrow('projection failed');
}, 20_000);

test('事件首次写入即持久化生成后的序号', async () => {
  await using storage = await Storage.open({ dataDir: 'memory://' });

  const record = await storage.journal.record('session', {
    type: 'message_end',
    message: { role: 'user', content: 'hello', timestamp: 1 },
  });

  const result = await storage.db.execute<{ sequence: number; storedSequence: number }>(sql`
    SELECT sequence, (record->>'sequence')::bigint AS "storedSequence"
    FROM storage.events
    WHERE id = ${record.id}
  `);

  expect(result.rows).toEqual([{ sequence: record.sequence, storedSequence: record.sequence }]);
});

test('start 与 end 持久化，update 只在当前进程实时分发', async () => {
  await using storage = await Storage.open({ dataDir: 'memory://' });

  const start = await storage.journal.record('session', {
    type: 'tool_execution_start',
    toolCallId: 'call',
    toolName: 'search',
    args: { query: '直播' },
  });

  const update = await storage.journal.record('session', {
    type: 'tool_execution_update',
    toolCallId: 'call',
    toolName: 'search',
    args: { query: '直播' },
    partialResult: { hits: 1 },
  });

  expect((await storage.journal.read()).map(record => record.id)).toEqual([start.id, update.id]);
  expect(update.transient).toBe(true);

  const end = await storage.journal.record('session', {
    type: 'tool_execution_end',
    toolCallId: 'call',
    toolName: 'search',
    result: { hits: 2 },
    isError: false,
  });

  expect((await storage.journal.read()).map(record => record.id)).toEqual([start.id, end.id]);

  const persisted = await storage.db.execute<{ id: string; type: string }>(sql`
    SELECT id, record->'event'->>'type' AS type
    FROM storage.events
    WHERE session_id = 'session'
    ORDER BY sequence
  `);

  expect(persisted.rows).toEqual([
    { id: start.id, type: 'tool_execution_start' },
    { id: end.id, type: 'tool_execution_end' },
  ]);
});

test('关闭等待进行中的事件提交并拒绝后续写入', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ciel-storage-'));
  let markTransactionStarted!: () => void;

  const transactionStarted = new Promise<void>(resolve => {
    markTransactionStarted = resolve;
  });

  let releaseTransaction!: () => void;

  const transactionPending = new Promise<void>(resolve => {
    releaseTransaction = resolve;
  });

  try {
    const storage = await Storage.open({ dataDir: directory });

    const recording = storage.journal.record('session', { type: 'agent_start' }, {}, async () => {
      markTransactionStarted();
      await transactionPending;
    });

    await transactionStarted;

    const closing = storage.close();
    let closed = false;

    void closing.then(() => {
      closed = true;
    });

    await Promise.resolve();
    expect(closed).toBe(false);

    await expect(storage.journal.record('session', { type: 'agent_start' })).rejects.toThrow(
      '已关闭',
    );

    releaseTransaction();
    const record = await recording;
    await closing;

    await using reopened = await Storage.open({ dataDir: directory });
    expect((await reopened.journal.read()).map(item => item.id)).toEqual([record.id]);
  } finally {
    releaseTransaction();
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
