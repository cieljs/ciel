import { expect, it, vi } from 'vite-plus/test';

import { ShutdownCoordinator } from './shutdown.ts';

it('关闭等待所有资源完成且多次调用共享同一个 Promise', async () => {
  const shutdown = new ShutdownCoordinator();
  const pending = Promise.withResolvers<void>();
  const first = vi.fn(() => pending.promise);
  const second = vi.fn(async () => {});
  shutdown.register(first);
  shutdown.register(second);

  const closing = shutdown.close();

  expect(shutdown.close()).toBe(closing);
  expect(shutdown.isComplete).toBe(false);
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();

  pending.resolve();
  await closing;

  expect(shutdown.isComplete).toBe(true);
});

it('任一资源关闭失败时等待其他资源完成并拒绝退出', async () => {
  const shutdown = new ShutdownCoordinator();
  const pending = Promise.withResolvers<void>();
  const failure = new Error('flush failed');

  shutdown.register(async () => {
    throw failure;
  });

  shutdown.register(() => pending.promise);

  const closing = shutdown.close();
  let settled = false;

  void closing.catch(() => {
    settled = true;
  });

  await Promise.resolve();
  expect(settled).toBe(false);

  pending.resolve();
  await expect(closing).rejects.toBe(failure);
  expect(shutdown.isComplete).toBe(false);
});

it('已注销的窗口资源不会参与应用关闭', async () => {
  const shutdown = new ShutdownCoordinator();
  const close = vi.fn(async () => {});
  const unregister = shutdown.register(close);

  unregister();
  await shutdown.close();

  expect(close).not.toHaveBeenCalled();
});
