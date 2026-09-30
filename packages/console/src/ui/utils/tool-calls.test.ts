import type { TraceEntry } from '@cieljs/trace/protocol';
import { expect, it } from 'vite-plus/test';

import {
  conversationEntries,
  indexToolCalls,
  toolCallStatus,
  toolResultEntry,
  toolResultPayload,
  toolResultText,
} from './tool-calls.ts';

const entry = (sequence: number, overrides: Partial<TraceEntry> = {}): TraceEntry => ({
  id: String(sequence),
  sequence,
  sessionId: 'test',
  kind: 'event',
  name: 'event',
  status: 'completed',
  startedAt: sequence,
  ...overrides,
});

const call = (sequence: number, overrides: Partial<TraceEntry> = {}) =>
  entry(sequence, { kind: 'tool', name: 'send_danmaku', toolCallId: 'call-1', ...overrides });

const result = (sequence: number, overrides: Partial<TraceEntry> = {}) =>
  entry(sequence, {
    kind: 'message',
    name: 'toolResult',
    toolCallId: 'call-1',
    output: { id: 'out', preview: '结果' },
    ...overrides,
  });

it('按 toolCallId 把执行摘要与 toolResult 消息连成一条记录', () => {
  const start = call(1);
  const finish = result(2);
  const calls = indexToolCalls([start, finish]);

  expect(calls.size).toBe(1);
  expect(calls.get('call-1')).toEqual({ call: start, result: finish });
});

it('忽略普通消息与没有 toolCallId 的条目', () => {
  const calls = indexToolCalls([
    entry(1, { kind: 'message', name: 'assistant' }),
    entry(2, { kind: 'message', name: 'user' }),
    entry(3, { kind: 'tool', name: 'send_danmaku' }),
    entry(4, { kind: 'event', name: 'turn_end' }),
  ]);

  expect([...calls]).toEqual([]);
});

it('一条消息里的多个工具调用各自成记录', () => {
  const calls = indexToolCalls([
    call(1, { toolCallId: 'call-a' }),
    call(2, { toolCallId: 'call-b' }),
    result(3, { toolCallId: 'call-a' }),
  ]);

  expect(calls.size).toBe(2);
  expect(calls.get('call-a')?.result).toBeDefined();
  expect(calls.get('call-b')?.result).toBeUndefined();
});

it('只有执行摘要或只有结果时不补造另一半', () => {
  const start = call(1);
  const running = indexToolCalls([start]);
  expect(running.get('call-1')).toEqual({ call: start });

  const finish = result(2);
  const orphan = indexToolCalls([finish]);
  expect(orphan.get('call-1')).toEqual({ result: finish });
});

it('内容等价时复用同一个 Map，条目更新时换新实例', () => {
  const start = call(1);
  const finish = result(2);
  const entries = [start, finish];
  const first = indexToolCalls(entries);
  const again = indexToolCalls(entries, first);

  expect(again).toBe(first);

  const updated = call(1, { revision: 2, status: 'error' });
  const changed = indexToolCalls([updated, finish], first);

  expect(changed).not.toBe(first);
  expect(changed.get('call-1')?.call).toBe(updated);
});

it('对话列表只保留消息且顺序不变', () => {
  const assistant = entry(1, { kind: 'message', name: 'assistant' });
  const tool = call(2);
  const perception = entry(3, { kind: 'message', name: 'user' });
  const calls = indexToolCalls([assistant, tool]);

  expect(conversationEntries([assistant, tool, perception], calls)).toEqual([
    assistant,
    perception,
  ]);
});

it('工具块确实承接结果时去掉 toolResult 卡片', () => {
  const assistant = entry(1, { kind: 'message', name: 'assistant' });
  const tool = call(2, { messageId: assistant.id });
  const finish = result(3);
  const entries = [assistant, tool, finish];

  expect(conversationEntries(entries, indexToolCalls(entries))).toEqual([assistant]);
});

it('工具条目没有来源消息时保留卡片，避免结果彻底不可见', () => {
  const tool = call(2);
  const finish = result(3);
  const entries = [tool, finish];

  expect(conversationEntries(entries, indexToolCalls(entries))).toEqual([finish]);
});

it('来源消息已被淘汰时保留卡片', () => {
  const tool = call(2, { messageId: 'evicted' });
  const finish = result(3);
  const entries = [tool, finish];

  expect(conversationEntries(entries, indexToolCalls(entries))).toEqual([finish]);
});

it('没有执行摘要只有结果时保留卡片', () => {
  const finish = result(3);
  const entries = [finish];

  expect(conversationEntries(entries, indexToolCalls(entries))).toEqual([finish]);
});

it('状态优先取工具条目，只有结果时视为已完成', () => {
  expect(toolCallStatus({ call: call(1, { status: 'running' }) })).toBe('running');
  expect(toolCallStatus({ call: call(1, { status: 'error' }) })).toBe('error');
  expect(toolCallStatus({ result: result(2) })).toBe('completed');
  expect(toolCallStatus({})).toBe('running');
  expect(toolCallStatus()).toBe('running');
});

it('结果来源优先带 output 引用的工具条目，其次 toolResult 消息', () => {
  const withOutput = call(1, { output: { id: 'out', preview: '结果' } });
  const pending = call(2);
  const finish = result(3);

  expect(toolResultEntry({ call: withOutput, result: finish })).toBe(withOutput);
  expect(toolResultEntry({ call: pending, result: finish })).toBe(finish);
  expect(toolResultEntry({ call: pending })).toBeUndefined();
});

it('展示载荷优先取 details，details 为空时回落到整个结果', () => {
  expect(toolResultPayload({ content: [], details: { status: 'delivered' } })).toEqual({
    status: 'delivered',
  });

  const failed = { content: [{ type: 'text', text: '失败' }], details: {} };
  expect(toolResultPayload(failed)).toBe(failed);

  const partial = { partial: true };
  expect(toolResultPayload(partial)).toBe(partial);
  expect(toolResultPayload('文本')).toBe('文本');
  expect(toolResultPayload(undefined)).toBeUndefined();
});

it('文本型结果取整段文本，其余形状交给 JSON 查看器', () => {
  expect(toolResultText('动态列表')).toBe('动态列表');
  expect(toolResultText('  ')).toBeUndefined();

  expect(
    toolResultText({
      content: [
        { type: 'text', text: '第一段' },
        { type: 'image' },
        { type: 'text', text: '第二段' },
      ],
    }),
  ).toBe('第一段\n第二段');

  expect(toolResultText({ content: [], details: { status: 'delivered' } })).toBeUndefined();
  expect(toolResultText({ status: 'delivered' })).toBeUndefined();
  expect(toolResultText(undefined)).toBeUndefined();
});
