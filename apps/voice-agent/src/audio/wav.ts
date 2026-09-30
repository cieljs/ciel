export interface ParsedWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  audioFormat: number;
  data: Buffer;
}

export interface DecodedPcm {
  sampleRate: number;
  channels: number;
  pcm: Buffer;
}

const RIFF = 0x46464952;
const WAVE = 0x45564157;
const FMT = 0x20746d66;
const DATA = 0x61746164;

export function parseWav(buffer: Buffer): ParsedWav {
  if (buffer.length < 44 || buffer.readUInt32LE(0) !== RIFF || buffer.readUInt32LE(8) !== WAVE) {
    throw new Error('不是有效的 WAV 文件：缺少 RIFF/WAVE 标识');
  }

  let offset = 12;
  let fmt: Omit<ParsedWav, 'data'> | undefined;
  let data: Buffer | undefined;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.readUInt32LE(offset);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const bodyStart = offset + 8;
    const bodyEnd = bodyStart + chunkSize;

    if (bodyEnd > buffer.length) {
      break;
    }

    if (chunkId === FMT) {
      if (chunkSize < 16) {
        throw new Error('WAV fmt 块不完整');
      }

      fmt = {
        sampleRate: buffer.readUInt32LE(bodyStart + 4),
        channels: buffer.readUInt16LE(bodyStart + 2),
        bitsPerSample: buffer.readUInt16LE(bodyStart + 14),
        audioFormat: buffer.readUInt16LE(bodyStart),
      };
    } else if (chunkId === DATA) {
      data = buffer.subarray(bodyStart, bodyEnd);
    }

    offset = bodyEnd + (chunkSize % 2);
  }

  if (!fmt) {
    throw new Error('WAV 缺少 fmt 块');
  }

  if (!data) {
    throw new Error('WAV 缺少 data 块');
  }

  return { ...fmt, data };
}

export function decodeWavToPcm16(buffer: Buffer): DecodedPcm {
  const wav = parseWav(buffer);

  if (wav.channels < 1) {
    throw new Error('WAV 声道数必须大于 0');
  }

  const pcm = decodeSamples(wav.data, wav);

  return { sampleRate: wav.sampleRate, channels: wav.channels, pcm };
}

function decodeSamples(data: Buffer, wav: ParsedWav): Buffer {
  if (wav.audioFormat === 1 && wav.bitsPerSample === 16) {
    return data;
  }

  const frameBytes = wav.channels * bytesPerSample(wav);

  if (data.length % frameBytes !== 0) {
    throw new Error('WAV data 块字节数与声道、位深不一致');
  }

  const frameCount = data.length / frameBytes;
  const output = Buffer.allocUnsafe(frameCount * wav.channels * 2);
  const bytes = bytesPerSample(wav);

  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < wav.channels; channel += 1) {
      const inputOffset = frame * frameBytes + channel * bytes;
      const value = readSample(data, inputOffset, wav);
      output.writeInt16LE(clampToInt16(value), (frame * wav.channels + channel) * 2);
    }
  }

  return output;
}

function bytesPerSample(wav: ParsedWav): number {
  return Math.ceil(wav.bitsPerSample / 8);
}

function readSample(data: Buffer, offset: number, wav: ParsedWav): number {
  if (wav.audioFormat === 3 && wav.bitsPerSample === 32) {
    return data.readFloatLE(offset) * 32_767;
  }

  switch (wav.bitsPerSample) {
    case 8: {
      return (data.readUInt8(offset) - 128) * 256;
    }

    case 16: {
      return data.readInt16LE(offset);
    }

    case 24: {
      return readInt24LE(data, offset);
    }

    case 32: {
      return data.readInt32LE(offset);
    }

    default: {
      throw new Error(`不支持的 WAV 位深：${wav.bitsPerSample}`);
    }
  }
}

function readInt24LE(data: Buffer, offset: number): number {
  const value = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);

  return value & 0x800000 ? value - 0x1000000 : value;
}

function clampToInt16(value: number): number {
  if (value > 32_767) {
    return 32_767;
  }

  if (value < -32_768) {
    return -32_768;
  }

  return Math.trunc(value);
}
