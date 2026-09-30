import type { TraceEntry } from '@cieljs/trace/protocol';
import { expect, it } from 'vite-plus/test';

import { groupTraceSteps, mergeTraceEntries, traceStepLabel } from './trace-entries.ts';

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

it('运行和轮次各自合并开始结束，保留期间消息和不同运行', () => {
  const steps = [
    entry(1, { name: 'agent_start', runId: 'run' }),
    entry(2, { name: 'turn_start', runId: 'run', turnId: 'first' }),
    entry(3, {
      kind: 'message',
      name: 'message_start',
      messageId: 'message',
      runId: 'run',
      turnId: 'first',
      label: 'Ciel',
    }),
    entry(4, {
      kind: 'message',
      name: 'message_end',
      messageId: 'message',
      runId: 'run',
      turnId: 'first',
      label: 'Ciel',
      endedAt: 4,
    }),
    entry(5, { name: 'turn_end', runId: 'run', turnId: 'first', endedAt: 5 }),
    entry(6, { name: 'turn_start', runId: 'second-run', turnId: 'second' }),
  ];

  const grouped = groupTraceSteps(steps);
  expect(grouped.map(traceStepLabel)).toEqual(['Agent 运行', '模型轮次', 'Ciel 回复', '模型轮次']);
  expect(grouped[0]).toMatchObject({ status: 'running', endedAt: undefined });
  expect(grouped[1]).toMatchObject({ startedAt: 2, endedAt: 5, status: 'completed' });

  expect(grouped[2]).toMatchObject({
    startedAt: 3,
    endedAt: 4,
    status: 'completed',
    turnNumber: 1,
  });

  expect(grouped[3]).toMatchObject({ status: 'running', turnNumber: 2 });

  const finished = groupTraceSteps([
    ...steps,
    entry(7, { name: 'agent_end', runId: 'run', endedAt: 7 }),
  ]);

  expect(finished[0]).toMatchObject({
    id: grouped[0]!.id,
    startedAt: 1,
    endedAt: 7,
    status: 'completed',
  });
});

it('同一工具的结果消息不再生成第二条，失败状态和原始事件仍可检查', () => {
  const common = { runId: 'run', toolCallId: 'call' };
  const error = { id: 'failed', path: ['event', 'result'], preview: '错误详情' };

  const steps = [
    entry(1, {
      ...common,
      kind: 'tool',
      name: 'tool_execution_start',
      label: '搜索房间',
      input: { id: 'input', preview: '参数' },
      raw: { id: 'start', preview: 'tool_execution_start' },
    }),
    entry(2, {
      ...common,
      kind: 'tool',
      name: 'tool_execution_end',
      status: 'error',
      error,
      endedAt: 2,
      raw: { id: 'failed', preview: 'tool_execution_end' },
    }),
    entry(3, {
      ...common,
      kind: 'message',
      name: 'message_end',
      label: 'toolResult',
      messageId: 'result',
      endedAt: 3,
      raw: { id: 'result', preview: 'message_end' },
    }),
  ];

  const [group] = groupTraceSteps(steps.toReversed());
  expect(groupTraceSteps(steps)).toHaveLength(1);

  expect(group).toMatchObject({
    kind: 'tool',
    label: '搜索房间',
    status: 'error',
    error,
    startedAt: 1,
    endedAt: 2,
    input: steps[0]!.input,
  });

  expect(group!.events.map(event => event.id)).toEqual(['start', 'failed', 'result']);
  expect(traceStepLabel(group!)).toBe('搜索房间');
});

it('历史补页保留分组 ID 并补全开始时间；相同工具 ID 不跨会话合并', () => {
  const end = entry(3, {
    kind: 'tool',
    name: 'tool_execution_end',
    runId: 'run',
    toolCallId: 'call',
    endedAt: 3,
  });

  const start = entry(1, {
    ...end,
    id: 'start',
    sequence: 1,
    name: 'tool_execution_start',
    startedAt: 1,
    endedAt: undefined,
  });

  const partial = groupTraceSteps([end])[0]!;
  const complete = groupTraceSteps([end, start])[0]!;
  expect(complete.id).toBe(partial.id);
  expect(complete.startedAt).toBe(1);
  expect(complete.endedAt).toBe(3);
  expect(groupTraceSteps([end, { ...end, id: 'other', sessionId: 'other' }])).toHaveLength(2);
});

it('分组记录 ID 按 Session、Run 和记录类型分段展示', () => {
  const [agent] = groupTraceSteps([
    entry(1, {
      sessionId: 'bilibili:room:1718908:2026-09-15',
      runId: '2a4132fd-3d8c-4e74-aed8-cc1ca6ac3e68',
      name: 'agent_start',
    }),
  ]);

  expect(agent?.id).toBe(
    'bilibili:room:1718908:2026-09-15/2a4132fd-3d8c-4e74-aed8-cc1ca6ac3e68/agent',
  );
});

it('历史页与推送重叠时去重，并保留较新的修订', () => {
  const newest = entry(2, { revision: 8 });

  expect(mergeTraceEntries([newest, entry(3)], [entry(1), entry(2, { revision: 4 })])).toEqual([
    entry(1),
    newest,
    entry(3),
  ]);
});

it('同一次工具调用保留开始时间和输入，不与其他 run 合并', () => {
  const start = entry(1, {
    kind: 'tool',
    runId: 'a',
    toolCallId: 'call',
    input: { id: 'input', preview: '参数' },
  });

  const end = entry(2, {
    kind: 'tool',
    runId: 'a',
    toolCallId: 'call',
    output: { id: 'output', preview: '结果' },
  });

  const other = entry(3, { kind: 'tool', runId: 'b', toolCallId: 'call' });
  const grouped = groupTraceSteps([start, end, other]);
  expect(grouped).toHaveLength(2);

  expect(grouped[0]).toMatchObject({
    startedAt: 1,
    revision: 2,
    input: start.input,
    output: end.output,
  });
});

it('轮数按 Session 内的 run 顺序累计，同一 run 的多个轮次共用一轮', () => {
  const grouped = groupTraceSteps([
    entry(1, { name: 'turn_start', runId: 'first-run', turnId: 'first-turn' }),
    entry(2, { name: 'turn_end', runId: 'first-run', turnId: 'first-turn' }),
    entry(3, { name: 'turn_start', runId: 'first-run', turnId: 'second-turn' }),
    entry(4, { name: 'turn_start', runId: 'second-run', turnId: 'third-turn' }),
  ]);

  expect(grouped.map(step => step.turnNumber)).toEqual([1, 1, 2]);
});

it('未结束分组的耗时定格在所在 run 最后一次事件，不读墙上时钟', () => {
  const grouped = groupTraceSteps([
    entry(1, { name: 'agent_start', runId: 'run', turnNumber: 1, startedAt: 1_000 }),
    entry(2, {
      name: 'turn_start',
      runId: 'run',
      turnId: 'turn',
      turnNumber: 1,
      startedAt: 1_000,
    }),
    entry(3, {
      kind: 'tool',
      name: 'tool_execution_start',
      label: '搜索',
      runId: 'run',
      toolCallId: 'call',
      turnNumber: 1,
      startedAt: 5_000,
    }),
  ]);

  // Agent 组自己最后一次事件是 1s，但 run 最后一次事件是 5s，定格值取后者。
  expect(grouped[0]).toMatchObject({ status: 'running', updatedAt: 1_000, runningUntil: 5_000 });
  expect(grouped.map(step => step.runningUntil)).toEqual([5_000, 5_000, 5_000]);
});

it('同一 run 的模型轮次与 Agent 行共用一个轮次号', () => {
  const grouped = groupTraceSteps([
    entry(1, { name: 'agent_start', runId: 'run', turnNumber: 5 }),
    entry(2, { name: 'turn_start', runId: 'run', turnId: 'first', turnNumber: 5 }),
    entry(3, {
      name: 'turn_end',
      runId: 'run',
      turnId: 'first',
      turnNumber: 5,
      endedAt: 3,
    }),
    entry(4, { name: 'turn_start', runId: 'run', turnId: 'second', turnNumber: 5 }),
    entry(5, {
      name: 'agent_end',
      runId: 'run',
      turnId: 'second',
      turnNumber: 5,
      endedAt: 5,
    }),
  ]);

  expect(grouped.map(step => [traceStepLabel(step), step.turnNumber])).toEqual([
    ['Agent 运行', 5],
    ['模型轮次', 5],
    ['模型轮次', 5],
  ]);
});
