import type { Agent } from '@earendil-works/pi-agent-core';
import type { WakeEvent } from 'cieljs/hearing';
import type { Perception } from 'cieljs/perception';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { ThoughtScheduler } from './thought-scheduler.ts';
import { createWakeContext } from './wake.ts';

describe('ThoughtScheduler', () => {
  it.each([
    [true, 'Request was aborted'],
    [false, 'Request was aborted'],
    [true, 'Request aborted'],
    [false, 'Request aborted'],
  ] as const)('主动取消=%s 时正确区分请求中止 %s 和运行失败', async (cancelled, message) => {
    let rejectPrompt!: (error: Error) => void;

    const prompt = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPrompt = reject;
        }),
    );

    const onError = vi.fn();

    const scheduler = new ThoughtScheduler({
      perception: { snapshot: vi.fn().mockResolvedValue({ compose: async () => [] }) },
      agent: { prompt },
      minimumIntervalMs: 0,
      startedAt: new Date(0),
      context: () => ({ role: 'user', content: '观察', timestamp: 0 }),
      onError,
    });

    scheduler.trigger(new Date(1));
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());

    if (cancelled) {
      scheduler.cancel();
    }

    rejectPrompt(new Error(`Agent 运行失败：${message}`));

    if (!cancelled) {
      await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    }

    await scheduler.close();
    expect(onError).toHaveBeenCalledTimes(cancelled ? 0 : 1);
  });

  it('忽略迟到和重复时间，后续快照边界保持递增', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const snapshot = vi.fn().mockResolvedValue({ compose: async () => [] });

    const scheduler = new ThoughtScheduler({
      perception: { snapshot },
      agent: { prompt },
      minimumIntervalMs: 0,
      startedAt: new Date(100),
      context: () => ({ role: 'user', content: '观察', timestamp: 0 }),
    });

    scheduler.trigger(new Date(110));
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    scheduler.trigger(new Date(105));
    scheduler.trigger(new Date(110));
    scheduler.trigger(new Date(120));
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));
    expect(snapshot).toHaveBeenLastCalledWith({ startAt: new Date(111), endAt: new Date(120) });
    await scheduler.close();
  });

  it('内容过滤后暂停自动提交，保留原始错误', async () => {
    const error = new Error('Provider finish_reason: content_filter');
    const prompt = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();

    const scheduler = new ThoughtScheduler({
      perception: { snapshot: vi.fn().mockResolvedValue({ compose: async () => [] }) },
      agent: { prompt },
      minimumIntervalMs: 0,
      startedAt: new Date(0),
      context: () => ({ role: 'user', content: '观察', timestamp: 0 }),
      onError,
    });

    scheduler.trigger(new Date(1));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));
    scheduler.trigger(new Date(2));
    await scheduler.close();
    expect(prompt).toHaveBeenCalledOnce();
  });

  it('思考期间的新触发会合并到下一轮', async () => {
    let releaseFirst: (() => void) | undefined;

    const firstRun = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });

    const prompt = vi
      .fn()
      .mockImplementationOnce(() => firstRun)
      .mockResolvedValue(undefined);

    const snapshot = vi.fn().mockResolvedValue({ compose: async () => [] });

    const scheduler = new ThoughtScheduler({
      perception: { snapshot } as Pick<Perception, 'snapshot'>,
      agent: { prompt } as unknown as Pick<Agent, 'prompt'>,
      minimumIntervalMs: 0,
      startedAt: new Date(0),
      context: () => ({ role: 'user', content: '观察直播', timestamp: Date.now() }),
    });

    scheduler.trigger(new Date(1));
    scheduler.trigger(new Date(2));
    scheduler.trigger(new Date(3));
    releaseFirst?.();

    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));
    await scheduler.close();

    expect(snapshot).toHaveBeenNthCalledWith(2, {
      startAt: new Date(2),
      endAt: new Date(3),
    });
  });

  it('关闭期间完成的快照不会启动新思考', async () => {
    const composing = Promise.withResolvers<[]>();
    const prompt = vi.fn();

    const scheduler = new ThoughtScheduler({
      perception: { snapshot: vi.fn().mockResolvedValue({ compose: () => composing.promise }) },
      agent: { prompt },
      minimumIntervalMs: 0,
      startedAt: new Date(0),
      context: () => ({ role: 'user', content: '观察', timestamp: 0 }),
    });

    scheduler.trigger(new Date(1));
    scheduler.trigger(new Date(2));
    const closing = scheduler.close();
    composing.resolve([]);
    await closing;
    scheduler.trigger(new Date(3));
    expect(prompt).not.toHaveBeenCalled();
  });

  it('单轮思考超过预算时中止本轮并报告超时', async () => {
    vi.useFakeTimers();
    let rejectPrompt!: (error: Error) => void;

    const prompt = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPrompt = reject;
        }),
    );

    const abort = vi.fn(() => rejectPrompt(new Error('Request was aborted')));
    const onError = vi.fn();

    const scheduler = new ThoughtScheduler({
      perception: { snapshot: vi.fn().mockResolvedValue({ compose: async () => [] }) },
      agent: { prompt, abort },
      minimumIntervalMs: 0,
      thinkTimeoutMs: 1_000,
      startedAt: new Date(0),
      context: () => ({ role: 'user', content: '观察', timestamp: 0 }),
      onError,
    });

    scheduler.trigger(new Date(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(prompt).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(abort).toHaveBeenCalledOnce();

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: '单轮思考超过 1000 ms，已中止本轮' }),
    );

    await scheduler.close();
    vi.useRealTimers();
  });
});

describe('关键词优先调度', () => {
  const wait = { minWaitMs: 1500, maxWaitMs: 4000 };
  let scheduler: ThoughtScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });

  afterEach(async () => {
    await scheduler.close();
    vi.useRealTimers();
  });

  function setup() {
    const signal: WakeEvent = { keyword: '夏尔', at: new Date(9000) };
    const prompt = vi.fn().mockResolvedValue(undefined);
    const snapshot = vi.fn().mockResolvedValue({ compose: async () => [] });

    const context = vi.fn((wake?: WakeEvent) => ({
      role: 'user' as const,
      content: wake ? createWakeContext(wake) : '普通观察',
      timestamp: Date.now(),
    }));

    scheduler = new ThoughtScheduler({
      perception: { snapshot },
      agent: { prompt },
      context,
      minimumIntervalMs: 60_000,
      startedAt: new Date(0),
    });

    return { signal, prompt, snapshot, context };
  }

  it('替换普通冷却定时器，语音结束后仍等满最短时间，再消费一次唤醒上下文', async () => {
    const { signal, prompt, snapshot, context } = setup();
    scheduler.trigger(new Date());
    await vi.advanceTimersByTimeAsync(100);
    scheduler.trigger(new Date());
    expect(scheduler.wake(signal, wait)).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    scheduler.trigger(new Date(), 'speechend');
    await vi.advanceTimersByTimeAsync(999);
    expect(prompt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(context).toHaveBeenLastCalledWith(signal);
    expect(snapshot).toHaveBeenLastCalledWith({ startAt: new Date(10001), endAt: new Date(11600) });
    scheduler.trigger(new Date(11601));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(context).toHaveBeenLastCalledWith(undefined);
  });

  it('没有语音结束时在上限触发，普通观察和重复唤醒不延长等待', async () => {
    const { signal, prompt } = setup();
    scheduler.wake(signal, wait);
    await vi.advanceTimersByTimeAsync(2000);
    scheduler.trigger(new Date());
    expect(scheduler.wake(signal, wait)).toBe(false);
    await vi.advanceTimersByTimeAsync(1999);
    expect(prompt).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(prompt).toHaveBeenCalledOnce();
  });

  it('唤醒在当前轮快照生成期间到达时只交给下一轮，不并发调用模型', async () => {
    const { signal, prompt, snapshot, context } = setup();
    const composing = Promise.withResolvers<[]>();
    snapshot.mockResolvedValueOnce({ compose: () => composing.promise });
    scheduler.trigger(new Date());
    scheduler.wake(signal, wait);
    await vi.advanceTimersByTimeAsync(5000);
    expect(prompt).not.toHaveBeenCalled();
    composing.resolve([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(context).toHaveBeenNthCalledWith(1, undefined);
    expect(context).toHaveBeenNthCalledWith(2, signal);
  });

  it('迟到的语音结束仍会重新安排唤醒，不因快照水位丢掉定时器', async () => {
    const { signal, prompt } = setup();
    scheduler.trigger(new Date());
    await vi.advanceTimersByTimeAsync(0);
    scheduler.wake(signal, wait);
    scheduler.trigger(new Date(9500), 'speechend');
    await vi.advanceTimersByTimeAsync(1500);
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it('取消会清除唤醒和待执行定时器', async () => {
    const { signal, prompt } = setup();
    scheduler.wake(signal, wait);
    scheduler.cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(prompt).not.toHaveBeenCalled();
    expect(scheduler.wake(signal, wait)).toBe(false);
  });
});

it('最终总结包含间隔内尚未思考的尾段感知', async () => {
  const tail = { role: 'user' as const, content: '最后一句语音', timestamp: 2 };
  const prompt = vi.fn().mockResolvedValue(undefined);
  const snapshot = vi.fn().mockResolvedValue({ compose: async () => [tail] });

  const scheduler = new ThoughtScheduler({
    perception: { snapshot },
    agent: { prompt },
    minimumIntervalMs: 60_000,
    startedAt: new Date(0),
    context: () => ({ role: 'user', content: '上下文', timestamp: 0 }),
  });

  scheduler.trigger(new Date(1));
  await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
  scheduler.trigger(new Date(2));
  await scheduler.finish('最终总结');
  expect(snapshot).toHaveBeenLastCalledWith({ startAt: new Date(2), endAt: expect.any(Date) });

  expect(prompt).toHaveBeenLastCalledWith(
    expect.arrayContaining([tail, expect.objectContaining({ content: '最终总结' })]),
  );
});
