import { Storage } from '@cieljs/storage';
import { expect, test, vi } from 'vite-plus/test';

import { vectorStorage } from './schema.ts';
import { VectorService } from './service.ts';

test('缓存隔离模型配置、用途与输入粒度，并去重并发和批内文本', async () => {
  await using storage = await Storage.open({ dataDir: 'memory://', modules: [vectorStorage] });
  const embedBatch = vi.fn(async (texts: string[]) => texts.map(() => [1, 0]));

  const options = {
    storage,
    provider: { model: 'same-name', dimensions: 2, embedBatch },
    providerId: 'provider-a',
    revision: 'v1',
    granularity: 'chunk',
    inputConfig: 'raw',
  };

  await using vectors = new VectorService(options);

  const [first, second] = await Promise.all([
    vectors.embedBatch(['hello', 'hello'], { purpose: 'document' }),
    vectors.embed('hello', { purpose: 'document' }),
  ]);

  expect(first).toEqual([
    [1, 0],
    [1, 0],
  ]);

  expect(second).toEqual([1, 0]);
  expect(embedBatch).toHaveBeenCalledTimes(1);
  first[0]![0] = 999;
  expect(await vectors.embed('hello', { purpose: 'document' })).toEqual([1, 0]);

  await using reopened = new VectorService(options);
  await reopened.embed('hello', { purpose: 'document' });
  expect(embedBatch).toHaveBeenCalledTimes(1);
  await reopened.embed('hello', { purpose: 'query' });
  expect(embedBatch).toHaveBeenCalledTimes(2);

  for (const change of [
    { providerId: 'provider-b' },
    { revision: 'v2' },
    { granularity: 'sentence' },
    { inputConfig: 'prefix-v2' },
    { provider: { ...options.provider, model: 'another-model' } },
    { provider: { ...options.provider, dimensions: 3 } },
  ]) {
    await using changed = new VectorService({ ...options, ...change });
    expect(changed.key('hello', 'document')).not.toBe(vectors.key('hello', 'document'));
  }
}, 20_000);

test('共享计算不受单个等待者取消影响，失败可重试', async () => {
  await using storage = await Storage.open({ dataDir: 'memory://', modules: [vectorStorage] });
  let release!: () => void;

  const embedBatch = vi.fn(async () => {
    await new Promise<void>(resolve => {
      release = resolve;
    });

    return [[1, 0]];
  });

  await using vectors = new VectorService({
    storage,
    provider: { model: 'test', dimensions: 2, embedBatch },
    providerId: 'test',
    revision: '1',
    granularity: 'chunk',
    inputConfig: 'raw',
  });
  const controller = new AbortController();
  const cancelled = vectors.embed('shared', { purpose: 'query', signal: controller.signal });
  const retained = vectors.embed('shared', { purpose: 'query' });
  const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(embedBatch).toHaveBeenCalledOnce());
  controller.abort();
  await rejected;
  release();
  expect(await retained).toEqual([1, 0]);

  embedBatch.mockRejectedValueOnce(new Error('offline'));
  await expect(vectors.embed('retry', { purpose: 'query' })).rejects.toThrow('offline');
  embedBatch.mockResolvedValueOnce([[0, 1]]);
  expect(await vectors.embed('retry', { purpose: 'query' })).toEqual([0, 1]);
}, 20_000);
