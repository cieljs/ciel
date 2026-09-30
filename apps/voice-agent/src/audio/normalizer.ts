import type { AudioInputChunk } from './types.ts';

const TARGET_SAMPLE_RATE = 16_000;

export class AudioNormalizer {
  private readonly pending: number[] = [];
  private position = 0;

  normalize(chunk: AudioInputChunk): Buffer {
    const samples = this.toMonoFloat(chunk);

    this.pending.push(...samples);

    const step = chunk.sampleRate / TARGET_SAMPLE_RATE;
    const output: number[] = [];

    while (Math.floor(this.position) + 1 < this.pending.length) {
      const base = Math.floor(this.position);
      const fraction = this.position - base;
      const value = this.pending[base] + (this.pending[base + 1] - this.pending[base]) * fraction;

      output.push(value);
      this.position += step;
    }

    const consumed = Math.floor(this.position);

    this.pending.splice(0, consumed);
    this.position -= consumed;

    return floatToS16le(output);
  }

  private toMonoFloat(chunk: AudioInputChunk): number[] {
    const bytesPerSample = chunk.format === 'f32le' ? 4 : 2;
    const frameCount = Math.floor(chunk.data.length / (chunk.channels * bytesPerSample));
    const samples = Array.from({ length: frameCount }, () => 0);

    for (let frame = 0; frame < frameCount; frame += 1) {
      let sum = 0;

      for (let channel = 0; channel < chunk.channels; channel += 1) {
        const offset = (frame * chunk.channels + channel) * bytesPerSample;

        sum +=
          chunk.format === 'f32le'
            ? chunk.data.readFloatLE(offset)
            : chunk.data.readInt16LE(offset) / 32_768;
      }

      samples[frame] = sum / chunk.channels;
    }

    return samples;
  }
}

function floatToS16le(samples: number[]): Buffer {
  const buffer = Buffer.allocUnsafe(samples.length * 2);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));

    buffer.writeInt16LE(sample < 0 ? sample * 32_768 : sample * 32_767, index * 2);
  }

  return buffer;
}
