import { Microphone, type MicrophoneInfo } from 'decibri';

import type { AudioInput, AudioInputChunk, AudioInputDevice, DeviceSelector } from './types.ts';

const BYTES_PER_SAMPLE = 2;

export function createAudioInput(options: { sampleRate: number; channels: number }): AudioInput {
  return new DecibriAudioInput(options);
}

class DecibriAudioInput implements AudioInput {
  private active?: Microphone;

  constructor(private readonly options: { sampleRate: number; channels: number }) {}

  async devices(): Promise<readonly AudioInputDevice[]> {
    return Microphone.devices().map(toInputDevice);
  }

  async *start(options: {
    device?: DeviceSelector;
    signal?: AbortSignal;
  }): AsyncIterable<AudioInputChunk> {
    const mic = await Microphone.open({
      sampleRate: this.options.sampleRate,
      channels: this.options.channels,
      dtype: 'int16',
      device: options.device,
      aec: 'tau',
    });

    this.active = mic;

    const sampleRate = this.options.sampleRate;
    const bytesPerFrame = this.options.channels * BYTES_PER_SAMPLE;
    let capturedSamples = 0;
    let firstFrameAt: number | undefined;

    const onAbort = () => mic.stop();

    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      for await (const data of mic) {
        if (options.signal?.aborted) {
          break;
        }

        // decibri 帧精确分块，capturedAt 用首帧墙钟 + 累计样本数构造单调时间线。
        firstFrameAt ??= Date.now();

        const capturedAt = new Date(firstFrameAt + (capturedSamples / sampleRate) * 1_000);

        capturedSamples += data.length / bytesPerFrame;

        yield {
          data,
          capturedAt,
          sampleRate,
          channels: this.options.channels,
          format: 's16le',
        };
      }
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
      mic.stop();

      if (this.active === mic) {
        this.active = undefined;
      }
    }
  }

  pushAecReference(data: Buffer): void {
    this.active?.pushAecReference(data);
  }

  async close(): Promise<void> {
    this.active?.stop();
    this.active = undefined;
  }
}

function toInputDevice(info: MicrophoneInfo): AudioInputDevice {
  return {
    index: info.index,
    id: info.id,
    name: info.name,
    defaultSampleRate: info.defaultSampleRate,
    isDefault: info.isDefault,
    maxInputChannels: info.maxInputChannels,
  };
}
