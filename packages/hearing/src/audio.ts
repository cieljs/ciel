import type { ASRSegment } from './types.ts';

/** 保留跨 chunk 的插值位置，避免重采样随分块方式累积漂移。 */
export class AudioNormalizer {
  private samples: number[] = [];
  private position = 0;
  private rate?: number;
  private channels?: number;

  // oxlint-disable-next-line eslint/complexity -- PCM 校验、声道折叠与重采样是同一有状态写入事务。
  write(chunk: ASRSegment): Float32Array {
    const rate = chunk.sampleRate ?? 16_000;
    const channels = chunk.channels ?? 1;

    if (!Number.isInteger(rate) || rate <= 0 || !Number.isInteger(channels) || channels <= 0) {
      throw new Error('Invalid PCM sample rate or channels');
    }

    if (chunk.format && chunk.format !== 's16le') {
      throw new Error('Unsupported PCM format');
    }

    if (chunk.data.length % (channels * 2)) {
      throw new Error('Audio must contain aligned s16le PCM frames');
    }

    if (!Number.isFinite(chunk.startAt.getTime())) {
      throw new Error('Invalid audio startAt');
    }

    if (this.rate !== undefined && (rate !== this.rate || channels !== this.channels)) {
      throw new Error('Flush before changing PCM format');
    }

    this.rate = rate;
    this.channels = channels;
    const mono = new Float32Array(chunk.data.length / (channels * 2));

    for (let frame = 0; frame < mono.length; frame++) {
      let sum = 0;

      for (let channel = 0; channel < channels; channel++) {
        const sample = chunk.data.readInt16LE((frame * channels + channel) * 2);
        sum += sample / (sample < 0 ? 32_768 : 32_767);
      }

      mono[frame] = sum / channels;
    }

    if (rate === 16_000) {
      return mono;
    }

    for (const sample of mono) {
      this.samples.push(sample);
    }

    return this.drain(false);
  }

  flush(): Float32Array {
    const result = this.drain(true);
    this.samples = [];
    this.position = 0;
    this.rate = undefined;
    this.channels = undefined;

    return result;
  }

  private drain(final: boolean): Float32Array {
    const output: number[] = [];
    const step = (this.rate ?? 16_000) / 16_000;
    const limit = this.samples.length - (final ? 0 : 1);

    while (this.position < limit) {
      const index = Math.floor(this.position);
      const left = this.samples[index]!;
      const right = this.samples[index + 1] ?? left;
      output.push(left + (right - left) * (this.position - index));
      this.position += step;
    }

    const consumed = Math.min(Math.floor(this.position), this.samples.length);
    this.samples.splice(0, consumed);
    this.position -= consumed;

    return Float32Array.from(output);
  }
}
