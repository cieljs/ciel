import { afterEach, expect, it, vi } from 'vite-plus/test';

import { waitForPage } from './wait-for-page.ts';

afterEach(() => vi.useRealTimers());

it('单次读取挂起时，独立计时器仍能超时', async () => {
  vi.useFakeTimers();
  const result = waitForPage(() => new Promise(() => {}), { action: '等待登录', timeoutMs: 100 });
  const rejected = expect(result).rejects.toThrow('等待登录超时');

  await vi.advanceTimersByTimeAsync(100);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});

it('轮询串行执行，成功后清理超时和下一次检查', async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValue('account');
  const result = waitForPage(read, { action: '等待登录', timeoutMs: 100, intervalMs: 10 });

  await vi.advanceTimersByTimeAsync(10);
  await expect(result).resolves.toBe('account');
  expect(read).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('取消后忽略迟到结果，不再安排轮询', async () => {
  vi.useFakeTimers();
  const pending = Promise.withResolvers<string | undefined>();
  const controller = new AbortController();

  const result = waitForPage(() => pending.promise, {
    action: '等待播放器',
    timeoutMs: 100,
    signal: controller.signal,
  });

  const rejected = expect(result).rejects.toThrow('切房');

  controller.abort(new Error('切房'));
  pending.resolve(undefined);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});

it('读取失败直接报告，不把脚本错误隐藏为未登录', async () => {
  vi.useFakeTimers();

  const result = waitForPage(
    async () => {
      throw new Error('页面已销毁');
    },
    {
      action: '等待登录',
      timeoutMs: 100,
    },
  );

  await expect(result).rejects.toThrow('页面已销毁');
  expect(vi.getTimerCount()).toBe(0);
});
