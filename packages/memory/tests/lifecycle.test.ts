import { Storage } from '@cieljs/storage';
import { VectorIndex } from '@cieljs/vector';
import { expect, test, vi } from 'vite-plus/test';

import { MemoryManager, memoryStorage } from '../src/index.ts';

test('关闭 Manager 不关闭共享数据库，重复关闭返回同一 Promise', async () => {
  await using storage = await Storage.open({ dataDir: 'memory://', modules: [memoryStorage] });
  const manager = await MemoryManager.open({ storage, timeZone: 'Asia/Shanghai' });
  const closing = manager.close();
  expect(manager.close()).toBe(closing);
  await closing;
  expect(() => manager.space('room')).toThrow();
  const another = await MemoryManager.open({ storage, timeZone: 'Asia/Shanghai' });
  await another.close();
});

test('关闭等待索引刷新，刷新失败向调用者报告且数据库仍可用', async () => {
  await using storage = await Storage.open({ dataDir: 'memory://', modules: [memoryStorage] });
  const manager = await MemoryManager.open({ storage, timeZone: 'Asia/Shanghai' });
  const failure = new Error('flush');
  const spy = vi.spyOn(VectorIndex.prototype, 'flush').mockRejectedValueOnce(failure);

  try {
    await expect(manager.close()).rejects.toBe(failure);
  } finally {
    spy.mockRestore();
  }

  const another = await MemoryManager.open({ storage, timeZone: 'Asia/Shanghai' });
  await another.close();
});
