// packages/embedding/tests/qwen.test.ts

import { beforeEach, describe, expect, test, vi } from 'vite-plus/test';

const { extractor, pipeline, fetchModelFile, env } = vi.hoisted(() => {
  const fetchModelFile = vi.fn();

  return {
    fetchModelFile,
    env: { fetch: fetchModelFile },
    extractor: vi.fn(async () => ({
      tolist: () => [[1, 0]],
    })),
    pipeline: vi.fn(),
  };
});

vi.mock('@huggingface/transformers', () => ({
  pipeline,
  env,
}));

import {
  DEFAULT_QWEN_EMBEDDING_BATCH_SIZE,
  QWEN_EMBEDDING_DIMENSIONS,
  QWEN_EMBEDDING_MODEL,
  qwen,
} from '../src/index.ts';

describe('qwen', () => {
  beforeEach(() => {
    extractor.mockClear();
    pipeline.mockReset();
    pipeline.mockResolvedValue(extractor);
    fetchModelFile.mockReset();
  });

  test('应该创建默认 Qwen Embedding', () => {
    const embedding = qwen({ cacheDir: '.cache' });

    expect(embedding.model).toBe(QWEN_EMBEDDING_MODEL);
    expect(embedding.dimensions).toBe(QWEN_EMBEDDING_DIMENSIONS);
    expect(embedding.batchSize).toBe(DEFAULT_QWEN_EMBEDDING_BATCH_SIZE);
  });

  test('应该支持 MRL 输出维度', () => {
    const embedding = qwen({
      cacheDir: '.cache',
      dimensions: 512,
    });

    expect(embedding.dimensions).toBe(512);
  });

  test('应该从 ModelScope 下载模型且不转发 Hugging Face 凭据', async () => {
    await qwen({ cacheDir: '.cache', dimensions: 2 }).embed('初始化下载', {
      purpose: 'query',
    });

    const headers = new Headers({ authorization: 'Bearer test', 'user-agent': 'test' });

    await env.fetch(
      'https://huggingface.co/onnx-community/Qwen3-Embedding-0.6B-ONNX/resolve/main/onnx/model_quantized.onnx',
      { headers },
    );

    const [url, options] = fetchModelFile.mock.calls[0]!;

    expect(url).toBe(
      'https://modelscope.cn/models/onnx-community/Qwen3-Embedding-0.6B-ONNX/resolve/master/onnx/model_quantized.onnx',
    );

    expect(options.headers.get('authorization')).toBeNull();
    expect(options.headers.get('user-agent')).toBe('test');
    expect(headers.get('authorization')).toBe('Bearer test');
  });

  test('应该保留其他模型的下载请求', async () => {
    await qwen({ cacheDir: '.cache', dimensions: 2 }).embed('初始化下载', {
      purpose: 'query',
    });

    const url = 'https://huggingface.co/other/model/resolve/main/config.json';
    const options = { headers: { authorization: 'Bearer test' } };

    await env.fetch(url, options);

    expect(fetchModelFile).toHaveBeenCalledWith(url, options);
  });

  test('加载失败后应该允许重试并共享成功的推理管线', async () => {
    pipeline.mockRejectedValueOnce(new TypeError('fetch failed'));
    const embedding = qwen({ cacheDir: '.cache', dimensions: 2 });

    await expect(embedding.embed('首次加载', { purpose: 'query' })).rejects.toThrow('fetch failed');

    await Promise.all([
      embedding.embed('重试', { purpose: 'query' }),
      embedding.embed('并发重试', { purpose: 'query' }),
    ]);

    expect(pipeline).toHaveBeenCalledTimes(2);
  });

  test('应该支持自定义 batchSize', () => {
    const embedding = qwen({
      cacheDir: '.cache',
      batchSize: 64,
    });

    expect(embedding.batchSize).toBe(64);
  });

  test('应该把自定义缓存目录传给 Transformers.js', async () => {
    const embedding = qwen({
      cacheDir: '.cache',
      dimensions: 2,
    });

    await embedding.embed('缓存目录', { purpose: 'document' });

    expect(pipeline).toHaveBeenCalledWith(
      'feature-extraction',
      'onnx-community/Qwen3-Embedding-0.6B-ONNX',
      expect.objectContaining({ cache_dir: '.cache' }),
    );
  });

  test('应该拒绝零维向量', () => {
    expect(() =>
      qwen({
        cacheDir: '.cache',
        dimensions: 0,
      }),
    ).toThrow('dimensions 必须是 1 到 1024 的整数');
  });

  test('应该拒绝超过原始向量维度', () => {
    expect(() =>
      qwen({
        cacheDir: '.cache',
        dimensions: 1025,
      }),
    ).toThrow('dimensions 必须是 1 到 1024 的整数');
  });

  test('应该拒绝非整数维度', () => {
    expect(() =>
      qwen({
        cacheDir: '.cache',
        dimensions: 512.5,
      }),
    ).toThrow('dimensions 必须是 1 到 1024 的整数');
  });

  test('应该复用 agent-kit 的 batchSize 校验', () => {
    expect(() =>
      qwen({
        cacheDir: '.cache',
        batchSize: 0,
      }),
    ).toThrow('batchSize 必须是 1 到 1000 的整数');

    expect(() =>
      qwen({
        cacheDir: '.cache',
        batchSize: 1001,
      }),
    ).toThrow('batchSize 必须是 1 到 1000 的整数');
  });
});
