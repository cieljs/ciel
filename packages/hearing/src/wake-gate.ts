import { AudioNormalizer } from './audio.ts';
import { KWS } from './kws.ts';
import type { KWSOptions, WakeEvent } from './kws.ts';
import type { ASRSegment, ASRStream } from './types.ts';

export interface WakeOptions extends Omit<KWSOptions, 'modelsPath'> {
  preRollMs?: number;
  maxListenMs?: number;
}

type ResolvedWakeOptions = WakeOptions & Pick<KWSOptions, 'modelsPath'>;

/** 唤醒只控制送入 ASR 的音频；KWS 持续监听并独立发出事件。 */
export class WakeGate {
  readonly kws: KWS;
  private readonly normalizer = new AudioNormalizer();
  private readonly preRoll: ASRSegment[] = [];
  private awakeAt?: number;
  private ended = false;
  private writing?: Promise<void>;
  private closing?: Promise<void>;
  private endAt?: number;

  constructor(
    private readonly asr: Pick<ASRStream, 'write' | 'flush' | 'on' | 'close'>,
    private readonly options: ResolvedWakeOptions,
  ) {
    const preRollMs = options.preRollMs ?? 1_500;
    const maxListenMs = options.maxListenMs ?? 15_000;

    if (!Number.isFinite(preRollMs) || preRollMs < 0 || preRollMs > 30_000) {
      throw new Error('Invalid wake preRollMs');
    }

    if (!Number.isFinite(maxListenMs) || maxListenMs <= 0) {
      throw new Error('Invalid wake maxListenMs');
    }

    this.kws = new KWS(options);

    this.kws.on('wake', (event: WakeEvent) => {
      this.awakeAt ??= event.at.getTime();
    });

    this.asr.on('speechend', () => {
      this.ended = true;
    });
  }

  write(chunk: ASRSegment): Promise<void> {
    if (this.closing) {
      return Promise.reject(new Error('ASR is closing'));
    }

    if (this.writing) {
      return Promise.reject(new Error('Await write() before sending more audio'));
    }

    const operation = this.feed(this.normalizer.write(chunk), chunk.startAt);
    this.writing = operation;

    return operation.finally(() => {
      this.writing = undefined;
    });
  }

  private async feed(samples: Float32Array, startAt: Date): Promise<void> {
    for (let offset = 0; offset < samples.length; offset += 1_600) {
      const part = samples.subarray(offset, offset + 1_600);
      const data = Buffer.alloc(part.length * 2);

      part.forEach((sample, index) => {
        const roundedSample = Math.round(sample * 32_767);
        const pcmSample = Math.max(-32_768, Math.min(32_767, roundedSample));

        data.writeInt16LE(pcmSample, index * 2);
      });

      const at = startAt.getTime() + offset / 16;
      const chunk = { data, startAt: new Date(at) };
      this.endAt = at + part.length / 16;
      const wasAwake = this.awakeAt !== undefined;
      this.preRoll.push(chunk);
      const cutoff = at - (this.options.preRollMs ?? 1_500);

      while (this.preRoll[0]!.startAt.getTime() < cutoff) {
        this.preRoll.shift();
      }

      await this.kws.write(chunk);

      if (this.awakeAt === undefined) {
        continue;
      }

      this.ended = false;

      if (!wasAwake) {
        for (const buffered of this.preRoll) {
          await this.asr.write(buffered);
        }
      } else {
        await this.asr.write(chunk);
      }

      if (this.ended || this.endAt - this.awakeAt >= (this.options.maxListenMs ?? 15_000)) {
        await this.asr.flush();
        this.awakeAt = undefined;
        this.preRoll.length = 0;
      }
    }
  }

  async flush(): Promise<void> {
    await this.writing;
    const tail = this.normalizer.flush();

    if (tail.length) {
      await this.feed(tail, new Date(this.endAt ?? 0));
    }

    const wasAwake = this.awakeAt !== undefined;
    await this.kws.flush();

    if (!wasAwake && this.awakeAt !== undefined) {
      for (const chunk of this.preRoll) {
        await this.asr.write(chunk);
      }
    }

    await this.asr.flush();
    this.awakeAt = undefined;
    this.preRoll.length = 0;
  }

  close(): Promise<void> {
    this.closing ??= this.finish();

    return this.closing;
  }

  private async finish(): Promise<void> {
    try {
      await this.flush();
    } finally {
      try {
        await this.asr.close();
      } finally {
        await this.kws.close();
      }
    }
  }
}
