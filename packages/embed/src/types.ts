// packages/embedding/src/types.ts

export type QwenEmbeddingDType = 'fp32' | 'fp16' | 'q8';

export type QwenEmbeddingDevice = 'wasm' | 'webgpu';

export interface QwenEmbeddingOptions {
  /**
   * Transformers.js 模型缓存目录。
   *
   * 相对路径相对于当前工作目录。
   */
  cacheDir: string;

  /**
   * 最终输出向量维度。
   *
   * Qwen3-Embedding-0.6B 原始输出为 1024 维，
   * 支持 MRL 截断。
   *
   * @default 1024
   */
  dimensions?: number;

  /**
   * 单次推理允许的最大文本数量。
   *
   * @default 32
   */
  batchSize?: number;

  /**
   * ONNX 权重精度。
   *
   * @default "q8"
   */
  dtype?: QwenEmbeddingDType;

  /**
   * Transformers.js 推理设备。
   *
   * 不指定时使用运行时默认设备。
   */
  device?: QwenEmbeddingDevice;

  /**
   * Query 使用的检索任务说明。
   */
  instruction?: string;
}
