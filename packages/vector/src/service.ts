import { createHash } from 'node:crypto';

import {
  assertEmbeddingVectors,
  resolveEmbeddingProvider,
  type EmbeddingOptions,
  type EmbeddingProvider,
} from '@cieljs/model-kit';
import type { Storage } from '@cieljs/storage';
import { eq } from 'drizzle-orm';

import { vectorCache, vectorStorage } from './schema.ts';

export interface VectorOptions {
  storage: Storage;
  provider: EmbeddingProvider;
  /** 服务商、部署或端点身份，不应包含密钥。 */
  providerId: string;
  revision: string;
  /** 输入粒度，例如 message、chunk 或 sentence。 */
  granularity: string;
  /** 分词、截断、前缀或归一化配置变化时更新。 */
  inputConfig: string;
}

export class VectorService implements AsyncDisposable {
  readonly model: string;
  readonly dimensions: number;
  readonly batchSize: number;
  private readonly provider;
  private readonly pending = new Map<string, Promise<number[]>>();
  private closed = false;

  constructor(readonly options: VectorOptions) {
    options.storage.require(vectorStorage);

    for (const value of [
      options.providerId,
      options.revision,
      options.granularity,
      options.inputConfig,
    ]) {
      if (!value.trim()) {
        throw new TypeError('向量 providerId、revision、inputConfig 不能为空');
      }
    }

    this.provider = resolveEmbeddingProvider(options.provider)!;
    this.dimensions = this.provider.dimensions;
    this.batchSize = this.provider.batchSize;

    this.model = hash(
      JSON.stringify([
        options.providerId,
        this.provider.model,
        options.revision,
        options.granularity,
        this.dimensions,
        options.inputConfig,
      ]),
    );
  }

  key(text: string, purpose: EmbeddingOptions['purpose']) {
    return hash(JSON.stringify([this.model, purpose, text]));
  }

  async embed(text: string, options: EmbeddingOptions): Promise<number[]> {
    return (await this.embedBatch([text], options))[0]!;
  }

  async embedBatch(texts: string[], options: EmbeddingOptions): Promise<number[][]> {
    if (this.closed) {
      throw new Error('VectorService 已关闭');
    }

    options.signal?.throwIfAborted();

    const missing: {
      key: string;
      text: string;
      resolve: (value: number[]) => void;
      reject: (error: unknown) => void;
    }[] = [];

    const results = texts.map(text => {
      const key = this.key(text, options.purpose);
      let promise = this.pending.get(key);

      if (!promise) {
        promise = new Promise<number[]>((resolve, reject) =>
          missing.push({ key, text, resolve, reject }),
        );

        this.pending.set(key, promise);

        void promise.then(
          () => this.pending.delete(key),
          () => this.pending.delete(key),
        );
      }

      return promise;
    });

    // 每个调用者只取消自己的等待，共享计算不会被其中一个调用者中断。
    void this.compute(missing, options.purpose);
    const result = Promise.all(results).then(vectors => vectors.map(vector => [...vector]));

    if (!options.signal) {
      return result;
    }

    const signal = options.signal;

    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });

      if (signal.aborted) {
        abort();
      }

      void result.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }

  private async compute(
    items: {
      key: string;
      text: string;
      resolve: (value: number[]) => void;
      reject: (error: unknown) => void;
    }[],
    purpose: EmbeddingOptions['purpose'],
  ) {
    try {
      const missing: typeof items = [];

      for (const item of items) {
        const [cached] = await this.options.storage.db
          .select()
          .from(vectorCache)
          .where(eq(vectorCache.key, item.key));

        if (cached) {
          item.resolve(cached.embedding);
        } else {
          missing.push(item);
        }
      }

      for (let start = 0; start < missing.length; start += this.batchSize) {
        const batch = missing.slice(start, start + this.batchSize);

        const vectors = await this.provider.embedBatch(
          batch.map(item => item.text),
          { purpose },
        );

        assertEmbeddingVectors(vectors, batch.length, this.dimensions);

        await this.options.storage.db
          .insert(vectorCache)
          .values(
            batch.map((item, index) => ({
              key: item.key,
              profile: this.model,
              purpose,
              content: item.text,
              embedding: vectors[index]!,
            })),
          )
          .onConflictDoNothing();

        batch.forEach((item, index) => item.resolve(vectors[index]!));
      }
    } catch (error) {
      for (const item of items) {
        item.reject(error);
      }
    }
  }

  async close() {
    this.closed = true;
    await Promise.allSettled(this.pending.values());
  }

  [Symbol.asyncDispose]() {
    return this.close();
  }
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
