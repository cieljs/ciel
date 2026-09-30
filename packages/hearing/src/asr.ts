import { EventEmitter } from 'node:events';

import sherpaOnnx from 'sherpa-onnx-node';
// @env node
import type {
  CircularBuffer as CircularBufferInstance,
  SpeechSegment,
  Vad as VadInstance,
} from 'sherpa-onnx-node';

import { AudioNormalizer } from './audio.ts';
import {
  SAMPLE_RATE,
  VAD_WINDOW_SIZE,
  DEFAULT_BUFFER_SECONDS,
  DEFAULT_MAX_SPEAKERS,
  DEFAULT_SPEAKER_THRESHOLD,
} from './constants.ts';
import { installKWSModels } from './kws.ts';
import { installModels, type InstallModelsOptions } from './model-installer.ts';
import { createAudioConfig } from './models.ts';
import { ProcessASR } from './process-asr.ts';
import { ASR_MODELS, DEFAULT_ASR_MODEL, type ASRModelId } from './registry.ts';
import { SpeakerTracker } from './speaker.ts';
import type { ASREventMap, ASROptions, ASRSegment, ASRResult, Unsubscribe } from './types.ts';
import { WakeGate } from './wake-gate.ts';

const { CircularBuffer, SpeakerEmbeddingExtractor, Vad } = sherpaOnnx;
export class NativeASR {
  private readonly emitter = new EventEmitter();
  private readonly buffer: CircularBufferInstance;
  private readonly bufferCapacity: number;
  private recognizer?: {
    transcribe(
      samples: Float32Array,
    ): Pick<ASRResult, 'content' | 'language' | 'emotion' | 'events'>;
  };
  private speaker?: SpeakerTracker;
  private vad?: VadInstance;
  private readonly normalizer = new AudioNormalizer();
  private readonly eventWindow: number;
  private eventOffset = 0;
  private closed = false;
  private readonly windowSize: number;
  private streamStartAt?: Date;
  private currentModel: ASRModelId;

  setModel(model: ASRModelId): void {
    if (this.closed) {
      throw new Error('ASR is closed');
    }

    if (model === this.currentModel) {
      return;
    }

    const definition = ASR_MODELS[model];

    if (!this.vad && !definition.events) {
      throw new Error('Selected ASR model does not support audio events');
    }

    // 先准备新识别器，失败时旧模型仍可继续；尾段必须由旧模型完成。
    const recognizer = definition.create(this.options.modelsPath);
    this.flush();
    this.recognizer = recognizer;
    this.currentModel = model;
  }

  // oxlint-disable-next-line eslint/complexity -- 构造阶段集中校验并装配可选 VAD、事件和说话人能力。
  constructor(private readonly options: ASROptions) {
    validateOptions(options);
    this.currentModel = options.model ?? DEFAULT_ASR_MODEL;

    const models = createAudioConfig(options.modelsPath, options.vad);
    const bufferSeconds = options.bufferSeconds ?? DEFAULT_BUFFER_SECONDS;
    this.bufferCapacity = Math.ceil(bufferSeconds * SAMPLE_RATE);
    this.buffer = new CircularBuffer(this.bufferCapacity);
    const model = ASR_MODELS[options.model ?? DEFAULT_ASR_MODEL];

    if (!model) {
      throw new Error(`Unsupported ASR model: ${options.model}`);
    }

    if (options.mode === 'events' && !model.events) {
      throw new Error('Selected ASR model does not support audio events');
    }

    this.recognizer = model.create(options.modelsPath);
    this.eventWindow = Math.round((options.eventWindowSeconds ?? 5) * SAMPLE_RATE);

    if (options.mode !== 'events') {
      this.vad = new Vad(models.vad, bufferSeconds);
    }

    this.windowSize = models.vad.tenVad?.windowSize ?? VAD_WINDOW_SIZE;

    if (options.speaker !== false) {
      this.speaker = new SpeakerTracker(
        new SpeakerEmbeddingExtractor(models.speaker),
        options.speaker ?? [],
        options.speakerThreshold ?? DEFAULT_SPEAKER_THRESHOLD,
        options.maxSpeakers ?? DEFAULT_MAX_SPEAKERS,
      );
    }
  }

  write(segment: ASRSegment): void {
    try {
      if (!this.streamStartAt) {
        this.streamStartAt = segment.startAt;
      }

      if (this.closed) {
        throw new Error('ASR is closed');
      }

      const samples = this.normalizer.write(segment);
      this.push(samples);
      this.processWindows();
      this.drainVad();
    } catch (error) {
      this.emit('error', toError(error));
    }
  }

  flush(): void {
    try {
      if (this.closed || !this.streamStartAt) {
        return;
      }

      this.push(this.normalizer.flush());
      this.processWindows();

      if (!this.vad) {
        this.processWindows();
        const remaining = this.buffer.size();

        if (remaining > 0) {
          this.transcribe({
            start: this.eventOffset,
            samples: this.buffer.get(this.buffer.head(), remaining),
          });
        }

        return;
      }

      const remaining = this.buffer.size();

      if (remaining > 0) {
        const samples = this.buffer.get(this.buffer.head(), remaining);
        this.buffer.pop(remaining);
        const padded = new Float32Array(this.windowSize);
        padded.set(samples);
        this.vad.acceptWaveform(padded);
      }

      this.vad.flush();
      this.drainVad();
    } catch (error) {
      this.emit('error', toError(error));
    } finally {
      this.vad?.reset();
      this.eventOffset = 0;
      this.buffer.reset();
      this.streamStartAt = undefined;
    }
  }

  on<K extends keyof ASREventMap>(event: K, callback: ASREventMap[K]): Unsubscribe {
    this.emitter.on(event, callback);

    return () => this.emitter.off(event, callback);
  }

  private emit<K extends keyof ASREventMap>(event: K, ...args: Parameters<ASREventMap[K]>): void {
    this.emitter.emit(event, ...args);
  }

  private push(samples: Float32Array): void {
    let offset = 0;

    while (offset < samples.length) {
      this.processWindows();
      const free = this.bufferCapacity - this.buffer.size();

      if (free === 0) {
        throw new Error('ASR circular buffer is full');
      }

      const length = Math.min(free, samples.length - offset);
      this.buffer.push(samples.subarray(offset, offset + length));
      offset += length;
    }
  }

  private processWindows(): void {
    if (!this.vad) {
      while (this.buffer.size() >= this.eventWindow) {
        const samples = this.buffer.get(this.buffer.head(), this.eventWindow);
        this.buffer.pop(this.eventWindow);
        this.transcribe({ start: this.eventOffset, samples });
        this.eventOffset += samples.length;
      }

      return;
    }

    while (this.buffer.size() >= this.windowSize) {
      const samples = this.buffer.get(this.buffer.head(), this.windowSize);
      this.buffer.pop(this.windowSize);
      this.vad.acceptWaveform(samples);
      this.drainVad();
    }
  }

  private drainVad(): void {
    while (this.vad && !this.vad.isEmpty()) {
      const segment = this.vad.front();
      this.vad.pop();
      this.transcribe(segment);
    }
  }

  private transcribe(segment: SpeechSegment): void {
    const baseAt = this.streamStartAt;

    if (!baseAt) {
      throw new Error('Cannot map ASR timestamps before audio is written');
    }

    const segmentStartAt = addSamples(baseAt, segment.start);
    const segmentEndAt = addSamples(segmentStartAt, segment.samples.length);
    this.emit('speechstart', segmentStartAt);

    const result = this.recognizer!.transcribe(segment.samples);

    if (result.content || result.events?.length) {
      this.emit('result', {
        ...result,
        model: this.currentModel,
        speaker: result.content ? this.speaker?.assign(segment.samples, SAMPLE_RATE) : undefined,
        startAt: segmentStartAt,
        endAt: segmentEndAt,
      });
    }

    this.emit('speechend', segmentEndAt);
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    try {
      this.flush();
    } finally {
      this.closed = true;
      this.recognizer = undefined;
      this.speaker = undefined;
      this.vad = undefined;
      this.emitter.removeAllListeners();
    }
  }
}

/**
 * 在普通 Node 中直接使用原生 sherpa；Electron 的 V8 memory cage 不允许 sherpa 返回堆外 ArrayBuffer，因此自动将识别工作移入独立 Node
 * ESM 进程。
 */
export class ASR implements AsyncDisposable {
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
  private readonly backend: NativeASR | ProcessASR;
  private readonly gate?: WakeGate;

  constructor(options: ASROptions) {
    this.backend = process.versions.electron ? new ProcessASR(options) : new NativeASR(options);

    if (options.wake) {
      this.gate = new WakeGate(this.backend, {
        ...options.wake,
        modelsPath: options.modelsPath,
      });
    }
  }

  async setModel(model: ASRModelId): Promise<void> {
    await this.backend.setModel(model);
  }

  write(segment: ASRSegment): void | Promise<void> {
    return this.gate ? this.gate.write(segment) : this.backend.write(segment);
  }

  flush(): void | Promise<void> {
    return this.gate ? this.gate.flush() : this.backend.flush();
  }

  on<K extends keyof ASREventMap>(event: K, callback: ASREventMap[K]): Unsubscribe {
    if (event === 'error' && this.gate) {
      const first = this.gate.kws.on('error', callback as ASREventMap['error']);
      const second = this.backend.on(event, callback);

      return () => {
        first();
        second();
      };
    }

    if (event === 'wake' && this.gate) {
      return this.gate.kws.on('wake', callback as ASREventMap['wake']);
    }

    return this.backend.on(event, callback);
  }

  close(): Promise<void> {
    return this.gate ? this.gate.close() : this.backend.close();
  }
}

function addSamples(at: Date, samples: number): Date {
  return addSeconds(at, samples / SAMPLE_RATE);
}

function addSeconds(at: Date, seconds: number): Date {
  return new Date(at.getTime() + seconds * 1_000);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

// oxlint-disable-next-line eslint/complexity -- 每个分支对应独立配置约束，集中校验可保留一致错误语义。
function validateOptions(options: ASROptions): void {
  for (const [name, value] of Object.entries(options.vad ?? {})) {
    if (value === undefined) {
      continue;
    }

    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`vad.${name} must be a positive number`);
    }
  }

  if (
    options.vad &&
    (options.vad?.maxSpeechDuration ?? 10) + (options.vad?.minSilenceDuration ?? 0.5) >
      (options.bufferSeconds ?? DEFAULT_BUFFER_SECONDS)
  ) {
    throw new Error('VAD speech and silence durations must fit in the audio buffer');
  }

  const seconds = options.eventWindowSeconds ?? 5;

  if (
    !Number.isFinite(seconds) ||
    Math.round(seconds * SAMPLE_RATE) < 1 ||
    (options.mode === 'events' && seconds > (options.bufferSeconds ?? DEFAULT_BUFFER_SECONDS))
  ) {
    throw new Error('eventWindowSeconds must fit in the audio buffer');
  }

  if (
    options.bufferSeconds !== undefined &&
    (!Number.isFinite(options.bufferSeconds) ||
      options.bufferSeconds < VAD_WINDOW_SIZE / SAMPLE_RATE)
  ) {
    throw new Error(`bufferSeconds must hold at least one ${VAD_WINDOW_SIZE}-sample VAD window`);
  }

  if (
    options.speakerThreshold !== undefined &&
    !(options.speakerThreshold > 0 && options.speakerThreshold <= 1)
  ) {
    throw new Error('speakerThreshold must be greater than 0 and at most 1');
  }

  if (
    options.maxSpeakers !== undefined &&
    (!Number.isInteger(options.maxSpeakers) || options.maxSpeakers < 1)
  ) {
    throw new Error('maxSpeakers must be a positive integer');
  }
}

export async function createASR(
  options: ASROptions,
  prepare: Omit<InstallModelsOptions, 'modelsPath'> = {},
): Promise<ASR> {
  await installModels({ ...prepare, ...options });

  if (options.wake && !options.wake.modelPath) {
    await installKWSModels({ ...prepare, modelsPath: options.modelsPath });
  }

  const asr = new ASR(options);

  try {
    await asr.flush();

    return asr;
  } catch (error) {
    await asr.close().catch(() => {});
    throw error;
  }
}
