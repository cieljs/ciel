import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Perception, PerceptionSnapshot } from 'cieljs/perception';
import { afterEach, describe, expect, test, vi } from 'vite-plus/test';

import { ConversationScheduler, type VoiceAgentEvent } from '../src/conversation/scheduler.ts';
import { SpeakController } from '../src/conversation/speak-tool.ts';

interface SnapshotCall {
  startAt: Date;
  endAt: Date;
}

interface Harness {
  scheduler: ConversationScheduler;
  events: VoiceAgentEvent[];
  snapshotCalls: SnapshotCall[];
  prompt: ReturnType<typeof vi.fn>;
}

function createHarness(options: {
  minimumThinkIntervalMs?: number;
  compose?: (call: SnapshotCall) => AgentMessage[];
  promptImpl?: () => Promise<void>;
}): Harness {
  const events: VoiceAgentEvent[] = [];
  const snapshotCalls: SnapshotCall[] = [];
  const speak = new SpeakController();

  const perception = {
    snapshot: async (opts?: { startAt?: Date; endAt?: Date }): Promise<PerceptionSnapshot> => {
      const startAt = opts?.startAt ?? new Date();
      const endAt = opts?.endAt ?? new Date();

      snapshotCalls.push({ startAt, endAt });

      return {
        id: `snapshot-${snapshotCalls.length}`,
        startAt,
        endAt,
        transcripts: [],
        frames: [],
        compose: async () => options.compose?.({ startAt, endAt }) ?? [],
      };
    },
  };

  const prompt = vi.fn(options.promptImpl ?? (async () => {}));
  const agent = { prompt };

  const scheduler = new ConversationScheduler({
    perception: perception as unknown as Pick<Perception, 'snapshot'>,
    agent: agent as never,
    speak,
    minimumThinkIntervalMs: options.minimumThinkIntervalMs ?? 0,
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    emit: event => events.push(event),
  });

  return { scheduler, events, snapshotCalls, prompt };
}

function contentMessage(): AgentMessage {
  return { role: 'user', content: '你好', timestamp: Date.now() };
}

async function flush(times = 4): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ConversationScheduler', () => {
  test('idle 时第一个 speechend 启动思考', async () => {
    const harness = createHarness({ compose: () => [contentMessage()] });

    harness.scheduler.handleSpeechEnd(new Date('2026-01-01T00:00:01.000Z'));
    await flush();

    expect(harness.prompt).toHaveBeenCalledTimes(1);
    expect(harness.events.some(event => event.type === 'think_started')).toBe(true);
    expect(harness.events.some(event => event.type === 'think_finished')).toBe(true);
    expect(harness.scheduler.state.status).toBe('idle');
  });

  test('增量快照按不重叠时间范围捕获', async () => {
    const harness = createHarness({ compose: () => [contentMessage()] });

    harness.scheduler.handleSpeechEnd(new Date('2026-01-01T00:00:01.000Z'));
    harness.scheduler.handleSpeechEnd(new Date('2026-01-01T00:00:02.000Z'));
    harness.scheduler.handleSpeechEnd(new Date('2026-01-01T00:00:03.000Z'));
    await flush();

    expect(harness.snapshotCalls).toHaveLength(3);
    expect(harness.snapshotCalls[0]?.startAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(harness.snapshotCalls[1]?.startAt.toISOString()).toBe('2026-01-01T00:00:01.001Z');
    expect(harness.snapshotCalls[2]?.startAt.toISOString()).toBe('2026-01-01T00:00:02.001Z');
  });

  test('thinking 时连续 speechend 只形成一个 pending window', async () => {
    let resolvePrompt: () => void = () => {};

    const harness = createHarness({
      compose: () => [contentMessage()],
      promptImpl: () =>
        new Promise<void>(resolve => {
          resolvePrompt = resolve;
        }),
    });

    harness.scheduler.handleSpeechEnd(new Date('2026-01-01T00:00:01.000Z'));
    await flush();
    expect(harness.prompt).toHaveBeenCalledTimes(1);
    expect(harness.scheduler.state.status).toBe('thinking');

    harness.scheduler.handleSpeechEnd(new Date('2026-01-01T00:00:02.000Z'));
    harness.scheduler.handleSpeechEnd(new Date('2026-01-01T00:00:03.000Z'));
    harness.scheduler.handleSpeechEnd(new Date('2026-01-01T00:00:04.000Z'));

    const thinking = harness.scheduler.state;

    expect(thinking.status).toBe('thinking');

    if (thinking.status === 'thinking') {
      expect(thinking.pending?.speechEndCount).toBe(3);
    }

    resolvePrompt();
    await flush();

    expect(harness.prompt).toHaveBeenCalledTimes(2);
    expect(harness.events.filter(event => event.type === 'think_started')).toHaveLength(2);
  });

  test('waiting 时新事件扩展截止时间，不新增 timer', async () => {
    vi.useFakeTimers();

    const harness = createHarness({
      minimumThinkIntervalMs: 1_000,
      compose: () => [contentMessage()],
    });

    harness.scheduler.handleSpeechEnd(new Date('2026-01-01T00:00:01.000Z'));
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.scheduler.state.status).toBe('idle');

    harness.scheduler.handleSpeechEnd(new Date('2026-01-01T00:00:02.000Z'));
    expect(harness.scheduler.state.status).toBe('waiting');

    harness.scheduler.handleSpeechEnd(new Date('2026-01-01T00:00:03.000Z'));

    const state = harness.scheduler.state;

    expect(state.status).toBe('waiting');

    if (state.status === 'waiting') {
      expect(state.pending.speechEndCount).toBe(2);
      expect(state.pending.endInclusive.toISOString()).toBe('2026-01-01T00:00:03.000Z');
    }

    expect(harness.prompt).toHaveBeenCalledTimes(1);
  });

  test('两次思考开始时间不小于 minimumThinkIntervalMs', async () => {
    vi.useFakeTimers();

    const harness = createHarness({
      minimumThinkIntervalMs: 1_000,
      compose: () => [contentMessage()],
    });

    harness.scheduler.handleSpeechEnd(new Date('2026-01-01T00:00:01.000Z'));
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.prompt).toHaveBeenCalledTimes(1);

    harness.scheduler.handleSpeechEnd(new Date('2026-01-01T00:00:02.000Z'));
    expect(harness.scheduler.state.status).toBe('waiting');

    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.prompt).toHaveBeenCalledTimes(2);
  });

  test('空快照推进游标但不调用 Agent', async () => {
    const harness = createHarness({ compose: () => [] });

    const endAt = new Date('2026-01-01T00:00:01.000Z');

    harness.scheduler.handleSpeechEnd(endAt);
    await flush();

    expect(harness.prompt).not.toHaveBeenCalled();
    expect(harness.scheduler.processedThroughTime.toISOString()).toBe(endAt.toISOString());
    expect(harness.scheduler.state.status).toBe('idle');
  });

  test('Agent 失败后窗口不丢失，退避后重试', async () => {
    vi.useFakeTimers();

    let attempts = 0;

    const harness = createHarness({
      compose: () => [contentMessage()],
      promptImpl: async () => {
        attempts += 1;

        if (attempts === 1) {
          throw new Error('模型失败');
        }
      },
    });

    harness.scheduler.handleSpeechEnd(new Date('2026-01-01T00:00:01.000Z'));
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);
    expect(harness.scheduler.state.status).toBe('waiting');

    await vi.advanceTimersByTimeAsync(1_000);
    expect(attempts).toBe(2);
    expect(harness.snapshotCalls).toHaveLength(1);
    expect(harness.scheduler.state.status).toBe('idle');
  });

  test('关闭后不再启动新的思考', async () => {
    const harness = createHarness({ compose: () => [contentMessage()] });

    await harness.scheduler.close();

    harness.scheduler.handleSpeechEnd(new Date('2026-01-01T00:00:01.000Z'));
    await flush();

    expect(harness.prompt).not.toHaveBeenCalled();
    expect(harness.scheduler.state.status).toBe('closed');
  });
});
