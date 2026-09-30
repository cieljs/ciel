import { Speaker, type SpeakerInfo } from 'decibri';

import type { SpeechAudio } from '../tts/types.ts';
import { resampleS16le } from './resample.ts';
import type { AudioOutput, AudioOutputDevice, DeviceSelector } from './types.ts';
import { decodeWavToPcm16 } from './wav.ts';

const WRITE_CHUNK_BYTES = 16_384;

export function createAudioOutput(options: { sampleRate: number }): AudioOutput {
  return new DecibriAudioOutput(options);
}

class DecibriAudioOutput implements AudioOutput {
  private active?: Speaker;

  constructor(private readonly options: { sampleRate: number }) {}

  async devices(): Promise<readonly AudioOutputDevice[]> {
    return Speaker.devices().map(toOutputDevice);
  }

  async play(
    audio: SpeechAudio,
    options: {
      device?: DeviceSelector;
      signal?: AbortSignal;
      onAecReference?: (pcm: Buffer) => void;
    },
  ): Promise<void> {
    const decoded = decodeAudio(audio);

    const pcm = resampleS16le(
      decoded.pcm,
      decoded.channels,
      decoded.sampleRate,
      this.options.sampleRate,
    );

    const speaker = await Speaker.open({
      sampleRate: this.options.sampleRate,
      channels: decoded.channels,
      dtype: 'int16',
      device: options.device,
    });

    this.active = speaker;

    try {
      for (let offset = 0; offset < pcm.length; offset += WRITE_CHUNK_BYTES) {
        if (options.signal?.aborted) {
          speaker.stop();

          return;
        }

        const chunk = pcm.subarray(offset, offset + WRITE_CHUNK_BYTES);

        options.onAecReference?.(chunk);
        await speaker.writeAsync(chunk);
      }

      await speaker.drainAsync();
    } finally {
      if (this.active === speaker) {
        this.active = undefined;
      }
    }
  }

  async stop(): Promise<void> {
    this.active?.stop();
    this.active = undefined;
  }

  async close(): Promise<void> {
    await this.stop();
  }
}

function decodeAudio(audio: SpeechAudio): { sampleRate: number; channels: number; pcm: Buffer } {
  if (audio.format === 'wav') {
    return decodeWavToPcm16(audio.data);
  }

  if (audio.sampleRate === undefined) {
    throw new Error('pcm_s16le 音频必须提供 sampleRate');
  }

  return {
    sampleRate: audio.sampleRate,
    channels: audio.channels ?? 1,
    pcm: audio.data,
  };
}

function toOutputDevice(info: SpeakerInfo): AudioOutputDevice {
  return {
    index: info.index,
    id: info.id,
    name: info.name,
    defaultSampleRate: info.defaultSampleRate,
    isDefault: info.isDefault,
    maxOutputChannels: info.maxOutputChannels,
  };
}
