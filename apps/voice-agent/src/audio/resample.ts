export function resampleS16le(
  pcm: Buffer,
  channels: number,
  fromRate: number,
  toRate: number,
): Buffer {
  if (fromRate === toRate) {
    return pcm;
  }

  const bytesPerSample = 2;
  const inFrames = Math.floor(pcm.length / (channels * bytesPerSample));
  const outFrames = Math.round((inFrames * toRate) / fromRate);
  const output = Buffer.allocUnsafe(outFrames * channels * bytesPerSample);
  const step = fromRate / toRate;

  for (let outFrame = 0; outFrame < outFrames; outFrame += 1) {
    const position = outFrame * step;
    const base = Math.floor(position);
    const next = Math.min(base + 1, inFrames - 1);
    const fraction = position - base;

    for (let channel = 0; channel < channels; channel += 1) {
      const a = pcm.readInt16LE((base * channels + channel) * bytesPerSample);
      const b = pcm.readInt16LE((next * channels + channel) * bytesPerSample);
      const value = a + (b - a) * fraction;

      output.writeInt16LE(clampToInt16(value), (outFrame * channels + channel) * bytesPerSample);
    }
  }

  return output;
}

function clampToInt16(value: number): number {
  if (value > 32_767) {
    return 32_767;
  }

  if (value < -32_768) {
    return -32_768;
  }

  return Math.round(value);
}
