import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';

import { LiveStatusMonitor, type LiveStatus } from './live-status-monitor.ts';

const monitors: LiveStatusMonitor[] = [];
beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  for (const monitor of monitors.splice(0)) {
    monitor.close();
  }

  vi.useRealTimers();
});

function setup() {
  const callbacks = {
    readStatus: vi.fn<() => Promise<LiveStatus>>().mockResolvedValue('live'),
    onOffline: vi.fn(),
    onMediaFailure: vi.fn(),
    onError: vi.fn(),
  };

  const monitor = new LiveStatusMonitor(callbacks);
  monitors.push(monitor);

  return { monitor, ...callbacks };
}

it('只通知一次下播，之后停止轮询', async () => {
  const { monitor, readStatus, onOffline } = setup();
  readStatus.mockResolvedValue('offline');
  monitor.start();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(onOffline).toHaveBeenCalledTimes(1);
  expect(readStatus).toHaveBeenCalledTimes(1);
});

it('查询失败不误判下播，下次检查继续恢复', async () => {
  const { monitor, readStatus, onOffline, onError } = setup();
  readStatus.mockRejectedValueOnce(new Error('网络失败')).mockResolvedValue('offline');
  monitor.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(onError).toHaveBeenCalledOnce();
  expect(onOffline).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(onOffline).toHaveBeenCalledOnce();
});

it('FFmpeg 在检查途中结束时等待查询并补充核实，不遗失退出通知', async () => {
  const { monitor, readStatus, onOffline, onMediaFailure } = setup();
  const pending = Promise.withResolvers<LiveStatus>();
  readStatus.mockReturnValue(pending.promise);
  monitor.start();
  monitor.mediaStopped();
  pending.resolve('live');
  await vi.advanceTimersByTimeAsync(0);
  expect(readStatus).toHaveBeenCalledTimes(2);
  expect(onMediaFailure).toHaveBeenCalledOnce();
  expect(onOffline).not.toHaveBeenCalled();
});

it('关闭后忽略迟到的下播结果', async () => {
  const { monitor, readStatus, onOffline } = setup();
  const pending = Promise.withResolvers<LiveStatus>();
  readStatus.mockReturnValue(pending.promise);
  monitor.start();
  monitor.close();
  pending.resolve('offline');
  await vi.advanceTimersByTimeAsync(10_000);
  expect(onOffline).not.toHaveBeenCalled();
  expect(readStatus).toHaveBeenCalledOnce();
});
