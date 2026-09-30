import { parseWav, type ParsedWav } from '../audio/wav.ts';
import type { SpeechAudio, SpeechSynthesisRequest, TextToSpeech } from './types.ts';

export interface XiaomiTextToSpeechOptions {
  apiKey: string;
  baseUrl?: string;
  model?: 'mimo-v2.5-tts';
}

const DEFAULT_BASE_URL = 'https://api.xiaomimimo.com/v1';
const DEFAULT_MODEL = 'mimo-v2.5-tts';

export function createXiaomiTextToSpeech(options: XiaomiTextToSpeechOptions): TextToSpeech {
  return new XiaomiTextToSpeech(options);
}

class XiaomiTextToSpeech implements TextToSpeech {
  readonly id = 'xiaomi';

  private closed = false;

  constructor(private readonly options: XiaomiTextToSpeechOptions) {}

  // oxlint-disable-next-line eslint/complexity -- 外部响应的可选链校验会被计入复杂度，但流程保持线性。
  async synthesize(request: SpeechSynthesisRequest): Promise<SpeechAudio> {
    if (this.closed) {
      throw new Error('TTS 已关闭');
    }

    const baseUrl = this.options.baseUrl ?? DEFAULT_BASE_URL;
    const model = this.options.model ?? DEFAULT_MODEL;

    const messages: { role: 'user' | 'assistant'; content: string }[] = [];

    if (request.instructions?.trim()) {
      messages.push({ role: 'user', content: request.instructions });
    }

    messages.push({ role: 'assistant', content: request.text });

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        audio: { format: request.format, voice: request.voice },
      }),
      signal: request.signal,
    });

    if (!response.ok) {
      throw new Error(`MiMo TTS 请求失败：HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      choices?: { message?: { audio?: { data?: unknown } } }[];
    };

    const base64 = payload.choices?.[0]?.message?.audio?.data;

    if (typeof base64 !== 'string' || base64.length === 0) {
      throw new Error('MiMo TTS 响应缺少音频数据');
    }

    const data = Buffer.from(base64, 'base64');

    const wav = parseWav(data);

    return {
      data,
      format: 'wav',
      mimeType: 'audio/wav',
      sampleRate: wav.sampleRate,
      channels: wav.channels,
      durationMs: computeDurationMs(wav),
    };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function computeDurationMs(wav: ParsedWav): number {
  const bytesPerSample = Math.ceil(wav.bitsPerSample / 8);
  const byteRate = wav.sampleRate * wav.channels * bytesPerSample;

  if (byteRate === 0) {
    return 0;
  }

  return Math.round((wav.data.length / byteRate) * 1_000);
}
