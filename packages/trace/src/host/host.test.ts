import { Storage } from '@cieljs/storage';
import { createRouterClient } from '@orpc/server';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type { TraceUpdate, TraceEntry } from '../protocol/index.ts';
import { TraceHost } from './host.ts';
import { createTraceRouter } from './router.ts';
import { traceStorage } from './store.ts';

const hosts: TraceHost[] = [];

async function host(capacity?: number) {
  const storage = await Storage.open({ dataDir: 'memory://', modules: [traceStorage] });
  const value = await TraceHost.open({ storage, capacity });
  hosts.push(value);

  return value;
}

async function entries(value: TraceHost): Promise<TraceEntry[]> {
  await value.flushRecords();

  return value.store.list<TraceEntry>('entry');
}

afterEach(async () => {
  for (const value of hosts) {
    await value.close();
    await value.storage.close();
  }

  hosts.length = 0;
  vi.useRealTimers();
});

describe('Trace 按需内容', () => {
  it('感知分段即时进入对话，且不写入 Agent 事件流', async () => {
    const value = await host();
    value.recordMessage('视频语音 · 0:01', '第一段', 'video');
    value.recordMessage('视频语音 · 0:02', '第二段', 'video');
    const snapshot = await entries(value);
    expect(snapshot).toHaveLength(2);

    expect(snapshot.every(entry => entry.kind === 'message' && entry.sessionId === 'video')).toBe(
      true,
    );

    const contents = await Promise.all(snapshot.map(entry => value.store.get(entry.output!.id)));
    expect(contents).toEqual(expect.arrayContaining(['第一段', '第二段']));
    expect(await value.storage.journal.read(0)).toEqual([]);
    const receive = value.agentListener('video');

    await receive({
      type: 'message_end',
      message: { role: 'user', content: '开始总结', timestamp: Date.now() },
    });

    const ordered = await entries(value);
    expect(ordered.at(-1)?.name).toBe('user');
    expect(new Set(ordered.map(entry => entry.sequence)).size).toBe(ordered.length);
  });

  it('大对象、循环引用和二进制不会进入事件消息', async () => {
    const value = await host();

    const data: Record<string, unknown> = {
      image: { type: 'image', mimeType: 'image/png', data: 'x'.repeat(200_000) },
      buffer: new Uint8Array(10_000),
    };

    data.self = data;
    value.record('frame', data);
    const snapshot = await entries(value);
    expect(JSON.stringify(snapshot).length).toBeLessThan(500);
    const id = snapshot[0]!.output!.id;
    const client = createRouterClient(createTraceRouter(value));

    expect(await client.values.get({ id, path: ['image'] })).toMatchObject({
      data: 'x'.repeat(200_000),
    });

    expect(await client.values.get({ id, path: ['buffer'] })).toBeInstanceOf(Uint8Array);
    const stored = (await value.store.get<Record<string, unknown>>(id))!;
    expect(stored.self).toBe(stored);
  });

  it('内容读取不执行 getter，并拒绝原型路径', async () => {
    const value = await host();
    const getter = vi.fn(() => 'secret');

    const data = Object.fromEntries(
      Array.from({ length: 250 }, (_, index) => [String(index), index]),
    );

    Object.defineProperty(data, 'secret', { get: getter });
    value.record('large', data);
    const id = (await entries(value))[0]!.output!.id;
    const client = createRouterClient(createTraceRouter(value));
    expect(await client.values.get({ id, path: ['secret'] })).toBe('[Getter / Setter]');
    await expect(client.values.get({ id, path: ['__proto__'] })).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  it('内存淘汰后仍可从存储读取完整内容', async () => {
    const value = await host(1);
    value.record('first', { text: 'one' });
    const first = (await entries(value))[0]!.output!.id;
    value.record('second', { text: 'two' });
    const client = createRouterClient(createTraceRouter(value));
    expect(await client.values.get({ id: first })).toEqual({ text: 'one' });
  });

  it('流式更新合并同一条消息，工具输入输出可追踪', async () => {
    const value = await host();
    vi.useFakeTimers();
    const listener = vi.fn();
    value.subscribe(listener);
    const receive = value.agentListener('room:1');

    await receive({
      type: 'tool_execution_start',
      toolCallId: 'call:1',
      toolName: 'search',
      args: { query: '主播' },
    });

    await receive({
      type: 'tool_execution_update',
      toolCallId: 'call:1',
      toolName: 'search',
      args: { query: '主播' },
      partialResult: { found: '处理中' },
    });

    await value.flushRecords();
    vi.advanceTimersByTime(60);

    const streaming = listener.mock.calls.at(-1)?.[0] as TraceUpdate;
    const running = streaming.entries.find(entry => entry.toolCallId === 'call:1');
    expect(running).toMatchObject({ status: 'running', input: { preview: 'Object' } });
    expect(await value.store.get(running!.output!.id)).toEqual({ found: '处理中' });

    expect((await value.store.list<TraceEntry>('step')).map(step => step.name)).toEqual([
      'tool_execution_start',
    ]);

    await receive({
      type: 'tool_execution_end',
      toolCallId: 'call:1',
      toolName: 'search',
      result: { found: true },
      isError: false,
    });

    await value.flushRecords();
    vi.advanceTimersByTime(60);
    expect(listener).toHaveBeenCalledTimes(2);

    expect((await entries(value))[0]).toMatchObject({
      kind: 'tool',
      status: 'completed',
      input: { preview: 'Object' },
      output: { preview: 'Object' },
    });
  });

  it('模型用量随宿主重放累计，并随更新推给客户端', async () => {
    const value = await host();
    vi.useFakeTimers();
    const listener = vi.fn();
    value.subscribe(listener);
    const receive = value.agentListener('live');

    await receive({
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

    await value.flushRecords();
    vi.advanceTimersByTime(60);

    expect(value.usage()).toEqual({
      total: { input: 120, output: 20, cacheRead: 800, cacheWrite: 0, total: 940 },
      context: { input: 120, output: 20, cacheRead: 800, cacheWrite: 0, total: 940 },
    });

    expect(listener.mock.calls.at(-1)?.[0].usage.total.total).toBe(940);
  });

  it('非法分页位置由 oRPC schema 拒绝', async () => {
    const client = createRouterClient(createTraceRouter(await host()));
    await expect(client.steps.list({ cursor: -1 })).rejects.toThrow();
  });

  it('会话压缩事件进入轨迹步骤，摘要可从详情读取', async () => {
    const value = await host();

    await value.storage.journal.record('room:compaction', {
      type: 'session_compaction',
      summary: '累计摘要',
      throughSeq: 3,
      createdAt: 10,
      contextTokens: 120,
    });

    await value.flushRecords();

    const client = createRouterClient(createTraceRouter(value));
    const steps = await client.steps.list({ sessionId: 'room:compaction' });

    expect(steps).toHaveLength(1);

    expect(steps[0]).toMatchObject({
      name: 'session_compaction',
      label: '上下文压缩',
      text: '累计摘要',
      sessionId: 'room:compaction',
    });

    // 压缩事件里的估算要经重放进入会话的当前上下文。
    expect(
      value.sessions().find(session => session.id === 'room:compaction')?.usage.context?.total,
    ).toBe(120);
  });

  it('按 Session 查询并重新回放各自的记录', async () => {
    const value = await host();

    await value.agentListener('room:first')({
      type: 'message_end',
      message: { role: 'user', content: '第一间房', timestamp: 10 },
    });

    await value.agentListener('room:second')({
      type: 'message_end',
      message: { role: 'user', content: '第二间房', timestamp: 20 },
    });

    await value.flushRecords();

    const client = createRouterClient(createTraceRouter(value));
    const firstEntries = await client.entries.list({ sessionId: 'room:first' });
    const secondSteps = await client.steps.list({ sessionId: 'room:second' });

    expect(firstEntries).toHaveLength(1);
    expect(firstEntries[0]?.sessionId).toBe('room:first');
    expect(secondSteps).toHaveLength(1);
    expect(secondSteps[0]?.sessionId).toBe('room:second');
    expect(value.sessions().map(session => session.id)).toEqual(['room:first', 'room:second']);
  });

  it('路由按宿主给定的 Session 边界隔离查询与订阅', async () => {
    const value = await host();

    await value.agentListener('watch:room')({
      type: 'message_end',
      message: { role: 'user', content: '直播消息', timestamp: 10 },
    });

    await value.agentListener('investigation:first')({
      type: 'message_end',
      message: { role: 'user', content: '调查消息', timestamp: 20 },
    });

    await value.flushRecords();

    const client = createRouterClient(
      createTraceRouter(value, {
        session: sessionId => sessionId.startsWith('investigation:'),
      }),
    );

    const updates = await client.updates();
    const initial = await updates.next();
    const snapshot = initial.value as TraceUpdate;

    expect(snapshot.sessions.map(session => session.id)).toEqual(['investigation:first']);
    expect(snapshot.entries.every(entry => entry.sessionId === 'investigation:first')).toBe(true);
    expect(await client.entries.list({ sessionId: 'watch:room' })).toEqual([]);
    await updates.return?.(undefined);
  });
});
