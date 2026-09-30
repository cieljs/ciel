import {
  resolveEmbeddingProvider,
  type EmbeddingOptions,
  type ResolvedEmbeddingProvider,
} from '@cieljs/model-kit';
import { env, pipeline } from '@huggingface/transformers';

import type { QwenEmbeddingOptions } from './types.ts';

export const QWEN_EMBEDDING_MODEL = 'Qwen3-Embedding-0.6B';

export const QWEN_EMBEDDING_SOURCE = 'onnx-community/Qwen3-Embedding-0.6B-ONNX';

const huggingFacePrefix = `https://huggingface.co/${QWEN_EMBEDDING_SOURCE}/resolve/main/`;
const modelScopePrefix = `https://modelscope.cn/models/${QWEN_EMBEDDING_SOURCE}/resolve/master/`;
let fetchInstalled = false;

function installModelFetch(): void {
  if (fetchInstalled) {
    return;
  }

  const fetchModelFile = env.fetch;

  // 仅重定向当前模型；导入包时不修改 Transformers.js 的全局下载函数。
  env.fetch = (input, init) => {
    const url = input.toString();

    if (!url.startsWith(huggingFacePrefix)) {
      return fetchModelFile(input, init);
    }

    const headers = new Headers(init?.headers);
    headers.delete('authorization');

    return fetchModelFile(modelScopePrefix + url.slice(huggingFacePrefix.length), {
      ...init,
      headers,
    });
  };

  fetchInstalled = true;
}

export const QWEN_EMBEDDING_DIMENSIONS = 1024;

export const DEFAULT_QWEN_EMBEDDING_BATCH_SIZE = 32;

export const DEFAULT_QWEN_QUERY_INSTRUCTION =
  'Given a retrieval query, retrieve relevant documents that answer the query.';

export function qwen(options: QwenEmbeddingOptions): ResolvedEmbeddingProvider {
  const dimensions = options.dimensions ?? QWEN_EMBEDDING_DIMENSIONS;
  const batchSize = options.batchSize ?? DEFAULT_QWEN_EMBEDDING_BATCH_SIZE;
  const dtype = options.dtype ?? 'q8';
  const instruction = options.instruction ?? DEFAULT_QWEN_QUERY_INSTRUCTION;

  assertDimensions(dimensions);

  const loadExtractor = () => {
    installModelFetch();

    return pipeline('feature-extraction', QWEN_EMBEDDING_SOURCE, {
      cache_dir: options.cacheDir,
      dtype,
      device: options.device,
    });
  };

  let extractorPromise: ReturnType<typeof loadExtractor> | undefined;

  const getExtractor = () => {
    extractorPromise ??= loadExtractor().catch((error: unknown) => {
      extractorPromise = undefined;
      throw error;
    });

    return extractorPromise;
  };

  const embedBatch = async (
    texts: string[],
    embeddingOptions: EmbeddingOptions,
  ): Promise<number[][]> => {
    if (!texts.length) {
      return [];
    }

    embeddingOptions.signal?.throwIfAborted();

    const extractor = await getExtractor();

    embeddingOptions.signal?.throwIfAborted();

    const inputs = texts.map(text => formatInput(text, embeddingOptions.purpose, instruction));

    const output = await extractor(inputs, {
      pooling: 'last_token',
      normalize: true,
    });

    embeddingOptions.signal?.throwIfAborted();

    const vectors = output.tolist() as number[][];

    if (dimensions === QWEN_EMBEDDING_DIMENSIONS) {
      return vectors;
    }

    return vectors.map(vector => truncateAndNormalize(vector, dimensions));
  };

  return resolveEmbeddingProvider({
    model: QWEN_EMBEDDING_MODEL,
    dimensions,
    batchSize,
    embedBatch,
  })!;
}

function formatInput(
  text: string,
  purpose: EmbeddingOptions['purpose'],
  instruction: string,
): string {
  if (purpose === 'document') {
    return text;
  }

  return `Instruct: ${instruction}\nQuery:${text}`;
}

function truncateAndNormalize(vector: number[], dimensions: number): number[] {
  const result = vector.slice(0, dimensions);

  let squaredNorm = 0;

  for (const value of result) {
    squaredNorm += value * value;
  }

  const norm = Math.sqrt(squaredNorm);

  if (norm === 0) {
    return result;
  }

  for (let index = 0; index < result.length; index++) {
    result[index] = result[index]! / norm;
  }

  return result;
}

function assertDimensions(dimensions: number): void {
  if (
    !Number.isSafeInteger(dimensions) ||
    dimensions < 1 ||
    dimensions > QWEN_EMBEDDING_DIMENSIONS
  ) {
    throw new TypeError(
      `Qwen Embedding dimensions 必须是 1 到 ${QWEN_EMBEDDING_DIMENSIONS} 的整数`,
    );
  }
}
