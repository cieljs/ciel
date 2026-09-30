import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel } from 'node:worker_threads';

import { sql, Storage } from '@cieljs/storage';
import { RPCLink } from '@orpc/client/message-port';
import { createRouterClient } from '@orpc/server';
import type { RouterClient } from '@orpc/server';
import { RPCHandler } from '@orpc/server/message-port';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { createTraceClient } from '../client/index.ts';
import type { TraceEntry } from '../protocol/index.ts';
import { TraceHost } from './host.ts';
import { createTraceRouter } from './router.ts';
import { traceStorage } from './store.ts';
const cleanup: (() => void | Promise<void>)[] = [];

it('实时订阅持续收到新消息和步骤，后台处理失败时明确报错', async () => {
  const storage = await Storage.open({ dataDir: 'memory://', modules: [traceStorage] });
  const host = await TraceHost.open({ storage });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});

  try {
    const client = createRouterClient(createTraceRouter(host));
    const updates = await client.updates();
    await updates.next();
    const next = updates.next();

    await host.agentListener('live')({
      type: 'message_end',
      message: { role: 'user', content: '新消息', timestamp: Date.now() },
    });

    await host.flushRecords();
    const update = await next;

    if (update.done) {
      throw new Error('实时订阅提前结束');
    }

    expect(update.value.entries.some(entry => entry.name === 'user')).toBe(true);
    expect(update.value.steps.some(step => step.name === 'message_end')).toBe(true);

    const failed = expect(updates.next()).rejects.toThrow('Trace 事件处理失败');
    const read = vi.spyOn(storage.journal, 'read').mockRejectedValueOnce(new Error('存储读取失败'));
    await expect(host.flushRecords()).rejects.toThrow('存储读取失败');
    read.mockRestore();
    await failed;
    expect(log).toHaveBeenCalledWith('Trace 事件处理失败', '存储读取失败');
  } finally {
    await host.close().catch(() => {});
    await storage.close();
    log.mockRestore();
  }
});

async function openHost(capacity?: number, directory = 'memory://') {
  const storage = await Storage.open({ dataDir: directory, modules: [traceStorage] });
  const host = await TraceHost.open({ storage, capacity });

  cleanup.push(async () => {
    await host.close();
    await storage.close();
  });

  return host;
}

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) {
    await close();
  }
});

it('运行日志的消息输出、工具输入输出和原始事件均可通过详情接口读取', async () => {
  const host = await openHost();
  const receive = host.agentListener('session');
  const message = { role: 'user' as const, content: '查看房间', timestamp: 0 };
  await receive({ type: 'message_start', message });
  await receive({ type: 'message_end', message });

  await receive({
    type: 'tool_execution_start',
    toolCallId: 'call',
    toolName: 'search',
    args: { query: '直播' },
  });

  await receive({
    type: 'tool_execution_end',
    toolCallId: 'call',
    toolName: 'search',
    result: { hits: [] },
    isError: false,
  });

  await host.flushRecords();

  const client = createRouterClient(createTraceRouter(host));
  const steps = await host.store.list<TraceEntry>('step');
  expect(await client.values.get(steps[1]!.output!)).toEqual(message);
  expect(await client.values.get(steps[2]!.input!)).toEqual({ query: '直播' });
  expect(await client.values.get(steps[3]!.output!)).toEqual({ hits: [] });

  expect(await client.values.get(steps[3]!.raw!)).toMatchObject({
    event: { type: 'tool_execution_end' },
  });

  const entries = await host.store.list<TraceEntry>('entry');
  expect(entries.filter(entry => entry.kind === 'message')).toHaveLength(1);
});

it('完整保存多轮事件、稳定消息 ID 和 toolCallId，快照不随原对象变化', async () => {
  const host = await openHost();
  cleanup.push(() => host.close());
  const receive = host.agentListener('session');

  const message = {
    role: 'user' as const,
    content: [{ type: 'text' as const, text: 'x'.repeat(20000) }],
    timestamp: 0,
  };

  receive({ type: 'agent_start' });
  receive({ type: 'turn_start' });
  receive({ type: 'message_start', message });
  receive({ type: 'message_end', message });

  receive({
    type: 'tool_execution_start',
    toolCallId: 'call-1',
    toolName: 'search',
    args: { text: 'hello' },
  });

  receive({
    type: 'tool_execution_end',
    toolCallId: 'call-1',
    toolName: 'search',
    result: { content: [{ type: 'text', text: 'result' }] },
    isError: false,
  });

  receive({ type: 'turn_end', message, toolResults: [] });
  receive({ type: 'turn_start' });
  receive({ type: 'message_start', message });
  receive({ type: 'message_end', message });
  receive({ type: 'turn_end', message, toolResults: [] });
  receive({ type: 'agent_end', messages: [message] });
  message.content = [];
  await host.flushRecords();
  const events = await host.storage.journal.read();

  expect(events.map(item => item.event.type)).toEqual([
    'agent_start',
    'turn_start',
    'message_start',
    'message_end',
    'tool_execution_start',
    'tool_execution_end',
    'turn_end',
    'turn_start',
    'message_start',
    'message_end',
    'turn_end',
    'agent_end',
  ]);

  expect(new Set(events.map(item => item.runId)).size).toBe(1);
  expect(events[2]!.messageId).toBe(events[3]!.messageId);
  expect(events[2]!.turnId).not.toBe(events[8]!.turnId);
  expect(events[4]!.toolCallId).toBe('call-1');
  const entries = await host.store.list<TraceEntry>('entry');
  expect(entries.find(entry => entry.kind === 'message')!.text).toHaveLength(20000);

  expect(await host.store.get(`${events[2]!.messageId}:output`)).toMatchObject({
    content: [{ text: 'x'.repeat(20000) }],
  });

  const controller = new AbortController();
  const stream = host.events(events[10]!.sequence, controller.signal);
  expect((await stream.next()).value?.event.type).toBe('agent_end');
  const pending = stream.next();
  controller.abort();
  expect((await pending).done).toBe(true);
});

it('轮次号按 Agent 运行分配：同一 run 的多轮共用一个号，新 run 递增', async () => {
  const host = await openHost();
  const receive = host.agentListener('runs');
  const message = { role: 'user' as const, content: 'x', timestamp: 0 };

  receive({ type: 'agent_start' });
  receive({ type: 'turn_start' });
  receive({ type: 'turn_end', message, toolResults: [] });
  receive({ type: 'turn_start' });
  receive({ type: 'turn_end', message, toolResults: [] });
  receive({ type: 'agent_end', messages: [message] });
  receive({ type: 'agent_start' });
  receive({ type: 'turn_start' });
  await host.flushRecords();

  const steps = await host.store.list<TraceEntry>('step', { sessionId: 'runs' });
  const numbers = new Map<string, Set<number | undefined>>();

  for (const step of steps) {
    const seen = numbers.get(step.runId!) ?? new Set<number | undefined>();
    seen.add(step.turnNumber);
    numbers.set(step.runId!, seen);
  }

  const runs = [...numbers.values()].map(seen => [...seen]);
  expect(runs).toHaveLength(2);
  expect(runs.every(seen => seen.length === 1)).toBe(true);
  expect(new Set(runs.flat())).toEqual(new Set([1, 2]));
});

it('淘汰后与宿主重启后均可按 ID 回读原始图片', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ciel-trace-'));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const host = await openHost(1, directory);
  host.record('image', { type: 'image', mimeType: 'image/png', data: 'a'.repeat(100000) });
  const entry = (await host.store.list<TraceEntry>('entry'))[0]!;
  host.record('next', 'hello');
  await host.close();
  await host.storage.close();
  const reopened = await openHost(1, directory);
  cleanup.push(() => reopened.close());
  expect(await reopened.store.get(entry.output!.id)).toMatchObject({ data: 'a'.repeat(100000) });
});

it('重放保留消息与宿主记录的顺序，随后新增消息使用更大的序号', async () => {
  const host = await openHost();
  const receive = host.agentListener('replay');
  const message = { role: 'user' as const, content: '第一条', timestamp: 0 };
  await receive({ type: 'agent_start' });
  await receive({ type: 'message_start', message });
  await host.flushRecords();
  host.record('perception', '听觉输入');
  await receive({ type: 'message_end', message });
  await receive({ type: 'agent_end', messages: [message] });
  await host.flushRecords();
  const before = await host.store.list<TraceEntry>('entry');
  await host.close();

  const reopened = await TraceHost.open({ storage: host.storage });
  cleanup.push(() => reopened.close());
  expect(await reopened.store.list('entry')).toEqual(before);

  await reopened.agentListener('replay')({
    type: 'message_end',
    message: { ...message, content: '第二条' },
  });

  await reopened.flushRecords();
  const after = await reopened.store.list<TraceEntry>('entry');
  expect(after.slice(0, -1)).toEqual(before);
  expect(after.at(-1)!.sequence).toBeGreaterThan(Math.max(...before.map(entry => entry.sequence)));
});

it('后台重放不阻塞 open()，追平后条目与用量与阻塞重放一致', async () => {
  const host = await openHost();

  await host.agentListener('live')({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [],
      api: 'openai-completions',
      provider: 'xiaomi',
      model: 'mimo-v2.5',
      stopReason: 'stop',
      timestamp: 0,
      usage: {
        input: 120,
        output: 20,
        cacheRead: 800,
        cacheWrite: 0,
        totalTokens: 940,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    },
  });

  await host.flushRecords();
  const before = await host.store.list<TraceEntry>('entry');
  await host.close();

  // 用量只由重放累计：后台重放追平后必须给出与阻塞重放相同的条目和快照。
  const reopened = await TraceHost.open({ storage: host.storage, awaitReplay: false });
  cleanup.push(() => reopened.close());
  await reopened.flushRecords();
  expect(await reopened.store.list('entry')).toEqual(before);

  expect(reopened.usage().total).toEqual({
    input: 120,
    output: 20,
    cacheRead: 800,
    cacheWrite: 0,
    total: 940,
  });
});

it('重放内容未变化时不重写已有投影', async () => {
  const host = await openHost();

  await host.agentListener('replay')({
    type: 'message_end',
    message: { role: 'user', content: '保持不变', timestamp: 1 },
  });

  await host.flushRecords();

  const before = await host.storage.db.execute<{ xmin: string }>(
    sql`SELECT xmin::text AS xmin FROM trace.records WHERE id = 'step:1'`,
  );

  await host.close();

  const state = await host.storage.db.execute<{ head: string }>(sql`
    SELECT encode(substring(value FROM 1 FOR 1), 'hex') AS head
    FROM trace.records
    WHERE category = 'projection_state'
  `);

  const read = vi.spyOn(host.storage.journal, 'read');
  const reopened = await TraceHost.open({ storage: host.storage });
  cleanup.push(() => reopened.close());

  const after = await host.storage.db.execute<{ xmin: string }>(
    sql`SELECT xmin::text AS xmin FROM trace.records WHERE id = 'step:1'`,
  );

  expect(state.rows).toEqual([{ head: '7b' }]);
  expect(read).toHaveBeenCalledWith(1);
  expect(after.rows[0]?.xmin).toBe(before.rows[0]?.xmin);
});

it('投影批次失败时记录和游标在同一事务回滚', async () => {
  const storage = await Storage.open({ dataDir: 'memory://', modules: [traceStorage] });
  const host = await TraceHost.open({ storage });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let constraintExists = false;

  try {
    await storage.db.execute(sql`
      ALTER TABLE trace.records
      ADD CONSTRAINT reject_projection_state CHECK (category <> 'projection_state')
    `);

    constraintExists = true;

    await host.agentListener('atomic')({
      type: 'message_end',
      message: { role: 'user', content: '事务回滚', timestamp: 1 },
    });

    await expect(host.flushRecords()).rejects.toThrow();

    const projected = await storage.db.execute<{ count: string }>(sql`
      SELECT COUNT(*) AS count FROM trace.records WHERE category IN ('step', 'entry')
    `);

    expect(Number(projected.rows[0]!.count)).toBe(0);

    await storage.db.execute(sql`
      ALTER TABLE trace.records DROP CONSTRAINT reject_projection_state
    `);

    constraintExists = false;
    await host.close().catch(() => {});

    const recovered = await TraceHost.open({ storage });

    expect(await recovered.store.list<TraceEntry>('entry')).toMatchObject([
      { sessionId: 'atomic', text: '事务回滚' },
    ]);

    await recovered.close();
  } finally {
    if (constraintExists) {
      await storage.db.execute(sql`
        ALTER TABLE trace.records DROP CONSTRAINT reject_projection_state
      `);
    }

    await host.close().catch(() => {});
    await storage.close();
    log.mockRestore();
  }
});

it('投影状态损坏时保留旧数据，后台重建后原子切换世代', async () => {
  const storage = await Storage.open({ dataDir: 'memory://', modules: [traceStorage] });
  const original = await TraceHost.open({ storage });

  await original.agentListener('rebuild')({
    type: 'message_end',
    message: { role: 'user', content: '仍可读取', timestamp: 1 },
  });

  await original.flushRecords();
  await original.close();

  await storage.db.execute(sql`
    UPDATE trace.records SET value = ${Buffer.from('{invalid')}
    WHERE category = 'projection_state'
  `);

  let releaseRead!: () => void;

  const waitForRead = new Promise<void>(resolve => {
    releaseRead = resolve;
  });

  const originalRead = storage.journal.read.bind(storage.journal);
  const read = vi.spyOn(storage.journal, 'read');

  read.mockImplementationOnce(async (...args) => {
    await waitForRead;

    return originalRead(...args);
  });

  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const rebuilt = await TraceHost.open({ storage, awaitReplay: false });

  try {
    expect(await rebuilt.store.list<TraceEntry>('entry')).toHaveLength(1);

    releaseRead();
    await rebuilt.flushRecords();

    const tables = await storage.db.execute<{ rebuild: string | null }>(sql`
      SELECT to_regclass('trace.records_rebuild')::text AS rebuild
    `);

    expect(tables.rows).toEqual([{ rebuild: null }]);

    expect(await rebuilt.store.list<TraceEntry>('entry')).toMatchObject([
      { sessionId: 'rebuild', text: '仍可读取' },
    ]);
  } finally {
    releaseRead();
    await rebuilt.close().catch(() => {});
    await storage.close();
    warning.mockRestore();
  }
});

it('两万条已投影历史从持久化游标启动，不重新扫描旧事件', async () => {
  const storage = await Storage.open({ dataDir: 'memory://', modules: [traceStorage] });
  const original = await TraceHost.open({ storage });

  await original.agentListener('large-history')({
    type: 'message_end',
    message: { role: 'user', content: '基准事件', timestamp: 1 },
  });

  await original.flushRecords();
  await original.close();

  const state = await storage.db.execute<{ value: Uint8Array }>(sql`
    SELECT value FROM trace.records WHERE category = 'projection_state'
  `);

  const projection = JSON.parse(Buffer.from(state.rows[0]!.value).toString('utf8'));
  projection.cursor = 20_000;

  await storage.db.execute(sql`
    UPDATE trace.records SET value = ${Buffer.from(JSON.stringify(projection))}
    WHERE category = 'projection_state'
  `);

  await storage.db.execute(sql`
    INSERT INTO storage.events (id, sequence, session_id, record)
    OVERRIDING SYSTEM VALUE
    SELECT
      'bulk-' || number,
      number,
      'large-history',
      jsonb_build_object(
        'version', 1,
        'id', 'bulk-' || number,
        'sequence', number,
        'sessionId', 'large-history',
        'runId', 'bulk-run',
        'timestamp', number,
        'event', jsonb_build_object('type', 'agent_start'),
        'metadata', jsonb_build_object()
      )
    FROM generate_series(2, 20000) AS number
  `);

  const read = vi.spyOn(storage.journal, 'read');
  const startedAt = performance.now();
  const reopened = await TraceHost.open({ storage });
  const elapsed = performance.now() - startedAt;

  try {
    expect(read).toHaveBeenCalledWith(20_000);
    expect(elapsed).toBeLessThan(1_000);
  } finally {
    await reopened.close();
    await storage.close();
  }
});

it('运行中重启会延续步骤去重状态', async () => {
  const host = await openHost();
  const receive = host.agentListener('running');
  const message = { role: 'user' as const, content: '继续运行', timestamp: 1 };
  await receive({ type: 'agent_start' });
  await receive({ type: 'message_start', message });
  await host.flushRecords();
  const before = host.sessions().find(session => session.id === 'running')!;
  await host.close();

  const reopened = await TraceHost.open({ storage: host.storage });
  cleanup.push(() => reopened.close());
  await reopened.agentListener('running')({ type: 'message_end', message });
  await reopened.flushRecords();
  const after = reopened.sessions().find(session => session.id === 'running')!;

  expect(after.steps).toBe(before.steps);
});

it('oRPC MessagePort 可读取完整内容和取消更新订阅', async () => {
  const host = await openHost();
  cleanup.push(() => host.close());
  const router = createTraceRouter(host);
  const handler = new RPCHandler(router);
  const channel = new MessageChannel();

  cleanup.push(() => {
    channel.port1.close();
    channel.port2.close();
  });

  handler.upgrade(channel.port1);
  channel.port1.start();
  channel.port2.start();

  const client: RouterClient<typeof router> = createTraceClient(
    new RPCLink({ port: channel.port2 }),
  );

  host.record('hello', '完整输出');
  const entries = await client.entries.list({ limit: 10 });
  expect(await client.values.get({ id: entries[0]!.output!.id })).toBe('完整输出');
  const controller = new AbortController();
  const stream = await client.updates(undefined, { signal: controller.signal });
  expect((await stream.next()).value?.entries).toHaveLength(1);
  controller.abort();
  await stream.return?.(undefined);
  await handler.close(channel.port1);
});

it('宿主关闭会结束等待中的更新订阅', async () => {
  const host = await openHost();
  cleanup.push(() => host.close());
  const client = createRouterClient(createTraceRouter(host));
  const updates = await client.updates();
  await updates.next();
  const pending = updates.next();
  host.close();
  expect((await pending).done).toBe(true);
});

it('缺少工具 start 的 update 仍实时分发原始事件但不持久化', async () => {
  const host = await openHost();
  cleanup.push(() => host.close());

  host.agentListener('late')({
    type: 'tool_execution_update',
    toolCallId: 'unknown',
    toolName: 'search',
    args: {},
    partialResult: { text: '部分结果' },
  });

  await host.flushRecords();
  const events = await host.storage.journal.read();
  expect(events).toHaveLength(1);
  expect(events[0]?.toolCallId).toBe('unknown');
  expect(events[0]?.transient).toBe(true);
  expect((await host.storage.db.execute(sql`SELECT id FROM storage.events`)).rows).toHaveLength(0);
});

it('两个观察器交错执行时保持独立的消息和 run 关联', async () => {
  const host = await openHost();
  cleanup.push(() => host.close());
  const first = host.agentListener('first');
  const second = host.agentListener('second');
  const message = { role: 'user' as const, content: 'hello', timestamp: 0 };
  first({ type: 'agent_start' });
  second({ type: 'agent_start' });
  first({ type: 'message_start', message });
  second({ type: 'message_start', message });
  first({ type: 'message_end', message });
  second({ type: 'message_end', message });
  await host.flushRecords();
  const events = await host.storage.journal.read();
  const a = events.filter(event => event.sessionId === 'first');
  const b = events.filter(event => event.sessionId === 'second');
  expect(a[1]?.messageId).toBe(a[2]?.messageId);
  expect(b[1]?.messageId).toBe(b[2]?.messageId);
  expect(a[1]?.messageId).not.toBe(b[1]?.messageId);
  expect(a[0]?.runId).not.toBe(b[0]?.runId);
});
