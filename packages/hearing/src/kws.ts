import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { pinyin } from 'pinyin-pro';
import sherpaOnnx from 'sherpa-onnx-node';
import type { KeywordSpotter, OnlineStream } from 'sherpa-onnx-node';

import { AudioNormalizer } from './audio.ts';
import { SAMPLE_RATE } from './constants.ts';
import { installFile, type InstallModelsOptions } from './download.ts';
import { ProcessASR } from './process-asr.ts';
import type { ASREventMap, ASRSegment, Unsubscribe } from './types.ts';

const MODEL = 'sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01';

const FILES = {
  encoder: 'encoder-epoch-12-avg-2-chunk-16-left-64.onnx',
  decoder: 'decoder-epoch-12-avg-2-chunk-16-left-64.onnx',
  joiner: 'joiner-epoch-12-avg-2-chunk-16-left-64.onnx',
  tokens: 'tokens.txt',
} as const;

export interface KWSOptions {
  modelsPath: string;
  keywords: readonly (string | { text: string; tokens: readonly string[] })[];
  /** 使用本地 sherpa 模型文件时跳过默认模型下载。 */
  modelPath?: string;
  threshold?: number;
  score?: number;
  cooldownMs?: number;
}

export interface WakeEvent {
  keyword: string;
  /** 关键词起点，按输入音频时间基准映射，不代表发送事件的时钟时间。 */
  at: Date;
}

export type KWSEventMap = Pick<ASREventMap, 'wake' | 'error'>;

export class NativeKWS {
  private readonly emitter = new EventEmitter();
  private readonly normalizer = new AudioNormalizer();
  private runtime?: KeywordSpotter;
  private stream?: OnlineStream;
  private startAt?: Date;
  private lastWake = -Infinity;

  // oxlint-disable-next-line eslint/complexity -- 原生 KWS 初始化集中验证模型文件、关键词和运行时参数。
  constructor(private readonly options: KWSOptions) {
    if (!options.keywords.length) {
      throw new Error('At least one wake keyword is required');
    }

    if (!Number.isFinite(options.cooldownMs ?? 1_500) || (options.cooldownMs ?? 1_500) < 0) {
      throw new Error('Invalid KWS cooldown');
    }

    if (
      !Number.isFinite(options.threshold ?? 0.25) ||
      (options.threshold ?? 0.25) <= 0 ||
      (options.threshold ?? 0.25) > 1
    ) {
      throw new Error('Invalid KWS threshold');
    }

    if (!Number.isFinite(options.score ?? 1) || (options.score ?? 1) <= 0) {
      throw new Error('Invalid KWS score');
    }

    const directory = options.modelPath ?? path.join(options.modelsPath, 'kws', MODEL);

    for (const file of Object.values(FILES)) {
      if (!isFile(path.join(directory, file))) {
        throw new Error(`Missing KWS model file: ${file}. Run createKWS() to prepare models.`);
      }
    }

    const vocabulary = new Set(
      readFileSync(path.join(directory, FILES.tokens), 'utf8')
        .split(/\r?\n/u)
        .map(line => line.split(/\s+/u)[0]!),
    );

    const lines = options.keywords
      .map(keyword => {
        const text = typeof keyword === 'string' ? keyword : keyword.text;
        const tokens = typeof keyword === 'string' ? keywordTokens(text) : [...keyword.tokens];

        if (!text.trim() || /[\r\n@]/u.test(text) || !tokens.length) {
          throw new Error('Invalid wake keyword');
        }

        for (const token of tokens) {
          if (!vocabulary.has(token) || /[\s:@#]/u.test(token)) {
            throw new Error(
              `Unknown KWS token: ${token}. Supply model-compatible tokens explicitly.`,
            );
          }
        }

        return `${tokens.join(' ')} @${text}`;
      })
      .join('\n');

    const keywordsFile = path.join(
      directory,
      `keywords-${createHash('sha256').update(lines).digest('hex').slice(0, 16)}.txt`,
    );

    writeFileSync(keywordsFile, `${lines}\n`);

    this.runtime = new sherpaOnnx.KeywordSpotter({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: path.join(directory, FILES.encoder),
          decoder: path.join(directory, FILES.decoder),
          joiner: path.join(directory, FILES.joiner),
        },
        tokens: path.join(directory, FILES.tokens),
        numThreads: 1,
        provider: 'cpu',
      },
      keywordsFile,
      keywordsThreshold: options.threshold ?? 0.25,
      keywordsScore: options.score ?? 1,
      numTrailingBlanks: 1,
      maxActivePaths: 4,
    });

    this.stream = this.runtime.createStream();
  }

  write(chunk: ASRSegment): void {
    if (!this.runtime || !this.stream) {
      throw new Error('KWS is closed');
    }

    const samples = this.normalizer.write(chunk);
    this.startAt ??= chunk.startAt;

    // 小块解码防止一次输入很长的录音只取到最后一个命中。
    for (let offset = 0; offset < samples.length; offset += 1_600) {
      this.stream.acceptWaveform({
        samples: samples.subarray(offset, offset + 1_600),
        sampleRate: SAMPLE_RATE,
      });

      this.decode();
    }
  }

  flush(): void {
    if (!this.runtime || !this.stream || !this.startAt) {
      return;
    }

    this.stream.acceptWaveform({ samples: this.normalizer.flush(), sampleRate: SAMPLE_RATE });
    this.stream.acceptWaveform({ samples: new Float32Array(SAMPLE_RATE), sampleRate: SAMPLE_RATE });
    this.stream.inputFinished();
    this.decode();
    this.stream = this.runtime.createStream();
    this.startAt = undefined;
  }

  on<K extends keyof KWSEventMap>(event: K, listener: KWSEventMap[K]): Unsubscribe {
    this.emitter.on(event, listener);

    return () => this.emitter.off(event, listener);
  }

  async close(): Promise<void> {
    if (!this.runtime) {
      return;
    }

    try {
      this.flush();
    } finally {
      this.stream = undefined;
      this.runtime = undefined;
    }
  }

  private decode(): void {
    while (this.runtime!.isReady(this.stream!)) {
      this.runtime!.decode(this.stream!);
      const result = this.runtime!.getResult(this.stream!);

      if (!result.keyword) {
        continue;
      }

      const time =
        this.startAt!.getTime() + (result.start_time + (result.timestamps[0] ?? 0)) * 1_000;

      this.runtime!.reset(this.stream!);

      if (time - this.lastWake < (this.options.cooldownMs ?? 1_500)) {
        continue;
      }

      this.lastWake = time;

      this.emitter.emit('wake', {
        keyword: result.keyword,
        at: new Date(time),
      } satisfies WakeEvent);
    }
  }
}

export class KWS implements AsyncDisposable {
  private readonly backend: NativeKWS | ProcessASR;
  constructor(options: KWSOptions) {
    this.backend = process.versions.electron
      ? new ProcessASR(options, 'kws')
      : new NativeKWS(options);
  }
  write(chunk: ASRSegment): void | Promise<void> {
    return this.backend.write(chunk);
  }
  flush(): void | Promise<void> {
    return this.backend.flush();
  }
  on<K extends keyof KWSEventMap>(event: K, listener: KWSEventMap[K]): Unsubscribe {
    if (this.backend instanceof ProcessASR) {
      return this.backend.on(event, listener as ASREventMap[K]);
    }

    return this.backend.on(event, listener);
  }
  close(): Promise<void> {
    return this.backend.close();
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
}

export async function createKWS(
  options: KWSOptions,
  prepare: Omit<InstallModelsOptions, 'modelsPath'> = {},
): Promise<KWS> {
  if (!options.modelPath) {
    await installKWSModels({ ...prepare, modelsPath: options.modelsPath });
  }

  const kws = new KWS(options);

  try {
    await kws.flush();

    return kws;
  } catch (error) {
    await kws.close().catch(() => {});
    throw error;
  }
}

export async function installKWSModels(options: InstallModelsOptions): Promise<string> {
  const directory = path.join(options.modelsPath, 'kws', MODEL);

  const missing = Object.values(FILES).filter(
    file => options.force || !isFile(path.join(directory, file)),
  );

  if (!missing.length) {
    return directory;
  }

  mkdirSync(directory, { recursive: true });
  const archive = path.join(directory, 'model.tar.bz2');

  await installFile(
    `https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/${MODEL}.tar.bz2`,
    archive,
    options,
  );

  for (const file of missing) {
    // 只读取固定成员到 stdout；不允许归档路径或符号链接写入文件系统。
    const { stdout } = await promisify(execFile)('tar', ['-xOf', archive, `${MODEL}/${file}`], {
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });

    if (!stdout.length) {
      throw new Error(`Empty KWS model file: ${file}`);
    }

    const target = path.join(directory, file);
    await writeFile(`${target}.part`, stdout);
    await rename(`${target}.part`, target);
  }

  return directory;
}

export function keywordTokens(text: string): string[] {
  const syllables = pinyin(text.replace(/\s/gu, ''), { type: 'array', toneSandhi: false });

  return syllables.flatMap(syllable => {
    const initial = syllable.match(/^(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])/u)?.[0];

    return initial ? [initial, syllable.slice(initial.length)].filter(Boolean) : [syllable];
  });
}

function isFile(file: string) {
  try {
    const stat = statSync(file);

    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}
