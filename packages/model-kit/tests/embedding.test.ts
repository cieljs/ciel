import { describe, expect, test, vi } from 'vite-plus/test';

import {
  assertEmbeddingVectors,
  DEFAULT_EMBEDDING_BATCH_SIZE,
  resolveEmbeddingProvider,
  type EmbeddingProvider,
} from '../src/index.ts';

describe('Embedding Provider', () => {
  test('解析默认批量大小并保留 Provider 的 this', async () => {
    const provider: EmbeddingProvider & { prefix: number } = {
      model: 'test/model',
      dimensions: 2,
      prefix: 1,
      async embedBatch(texts) {
        return texts.map(() => [this.prefix, 0]);
      },
    };

    const resolved = resolveEmbeddingProvider(provider)!;

    expect(resolved.batchSize).toBe(DEFAULT_EMBEDDING_BATCH_SIZE);
    await expect(resolved.embed('query', { purpose: 'query' })).resolves.toEqual([1, 0]);
    await expect(resolved.embedBatch(['query'], { purpose: 'query' })).resolves.toEqual([[1, 0]]);
  });

  test('优先使用 Provider 的单文本入口', async () => {
    const embed = vi.fn(async () => [0, 1]);
    const embedBatch = vi.fn(async () => [[1, 0]]);

    const resolved = resolveEmbeddingProvider({
      model: 'test/model',
      dimensions: 2,
      embed,
      embedBatch,
    })!;

    await expect(resolved.embed('query', { purpose: 'query' })).resolves.toEqual([0, 1]);
    expect(embed).toHaveBeenCalledOnce();
    expect(embedBatch).not.toHaveBeenCalled();
  });

  test('拒绝无效 Provider 配置', () => {
    const embedBatch = vi.fn(async () => [[1]]);

    expect(() => resolveEmbeddingProvider({ model: ' ', dimensions: 1, embedBatch })).toThrow(
      '模型标识不能为空',
    );

    expect(() =>
      resolveEmbeddingProvider({ model: 'test/model', dimensions: 0, embedBatch }),
    ).toThrow('维数必须是 1 到 16000 的整数');

    expect(() =>
      resolveEmbeddingProvider({
        model: 'test/model',
        dimensions: 1,
        batchSize: 1_001,
        embedBatch,
      }),
    ).toThrow('batchSize 必须是 1 到 1000 的整数');
  });

  test('验证返回数量、维数和值', () => {
    expect(() => assertEmbeddingVectors([], 1, 2)).toThrow('返回数量必须为 1');
    expect(() => assertEmbeddingVectors([[1]], 1, 2)).toThrow('向量维数');
    expect(() => assertEmbeddingVectors([[Number.NaN, 1]], 1, 2)).toThrow('有限数值');
    expect(() => assertEmbeddingVectors([[0, 0]], 1, 2)).toThrow('零向量');
    expect(() => assertEmbeddingVectors([[1, 0]], 1, 2)).not.toThrow();
  });
});
