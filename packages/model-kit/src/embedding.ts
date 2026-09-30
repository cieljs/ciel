export const DEFAULT_EMBEDDING_BATCH_SIZE = 32;
export const MAX_EMBEDDING_BATCH_SIZE = 1_000;
export const MAX_EMBEDDING_DIMENSIONS = 16_000;

export interface EmbeddingOptions {
  /** 区分检索查询与待索引文档，供模型选择前缀或任务类型。 */
  purpose: 'query' | 'document';
  signal?: AbortSignal;
}

export interface EmbeddingProvider {
  /** 模型标识；更换模型或版本时必须同步更新。 */
  readonly model: string;
  /** 输出向量维数。 */
  readonly dimensions: number;
  /** 单次索引请求的最大文本数，默认 32。 */
  readonly batchSize?: number;
  /** 生成单个文本的向量；省略时由 `embedBatch` 自动实现。 */
  embed?(text: string, options: EmbeddingOptions): Promise<number[]>;
  /** 返回顺序必须与输入一致；查询也使用单元素数组。 */
  embedBatch(texts: string[], options: EmbeddingOptions): Promise<number[][]>;
}

export interface ResolvedEmbeddingProvider extends EmbeddingProvider {
  readonly batchSize: number;
  embed(text: string, options: EmbeddingOptions): Promise<number[]>;
}

export function resolveEmbeddingProvider(
  provider: EmbeddingProvider | undefined,
): ResolvedEmbeddingProvider | undefined {
  if (!provider) {
    return undefined;
  }

  assertEmbeddingProvider(provider);

  const embed = async (text: string, options: EmbeddingOptions) => {
    if (provider.embed) {
      const vector = await provider.embed(text, options);
      assertEmbeddingVectors([vector], 1, provider.dimensions);

      return vector;
    }

    const vectors = await provider.embedBatch([text], options);
    assertEmbeddingVectors(vectors, 1, provider.dimensions);

    return vectors[0]!;
  };

  return {
    model: provider.model,
    dimensions: provider.dimensions,
    batchSize: provider.batchSize ?? DEFAULT_EMBEDDING_BATCH_SIZE,
    embed,
    embedBatch: (texts, options) => provider.embedBatch(texts, options),
  };
}

export function assertEmbeddingProvider(provider: EmbeddingProvider): void {
  if (!provider.model.trim()) {
    throw new TypeError('Embedding 模型标识不能为空');
  }

  if (!isIntegerInRange(provider.dimensions, 1, MAX_EMBEDDING_DIMENSIONS)) {
    throw new TypeError('Embedding 维数必须是 1 到 16000 的整数');
  }

  const batchSize = provider.batchSize ?? DEFAULT_EMBEDDING_BATCH_SIZE;

  if (!isIntegerInRange(batchSize, 1, MAX_EMBEDDING_BATCH_SIZE)) {
    throw new TypeError('Embedding batchSize 必须是 1 到 1000 的整数');
  }
}

export function assertEmbeddingVectors(
  vectors: unknown,
  expectedCount: number,
  dimensions: number,
): asserts vectors is number[][] {
  if (!Array.isArray(vectors) || vectors.length !== expectedCount) {
    const expected = expectedCount === 1 ? '必须为 1' : `必须与输入数量 ${expectedCount} 一致`;
    throw new TypeError(`Embedding 返回数量${expected}`);
  }

  for (const vector of vectors) {
    const hasCorrectDimensions = Array.isArray(vector) && vector.length === dimensions;

    const containsOnlyFiniteValues =
      hasCorrectDimensions &&
      vector.every(value => typeof value === 'number' && Number.isFinite(value));

    const containsNonZeroValue = containsOnlyFiniteValues && vector.some(value => value !== 0);

    if (!hasCorrectDimensions) {
      throw new TypeError('Embedding 向量维数与模型配置不一致');
    }

    if (!containsOnlyFiniteValues) {
      throw new TypeError('Embedding 向量只能包含有限数值');
    }

    if (!containsNonZeroValue) {
      throw new TypeError('Embedding 向量必须是非零向量');
    }
  }
}

function isIntegerInRange(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
