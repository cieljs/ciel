import { afterEach, describe, expect, test, vi } from 'vite-plus/test';

import { createXiaomiTextToSpeech } from '../src/tts/xiaomi.ts';

function buildWav(sampleRate = 24_000, channels = 1, frameCount = 100): Buffer {
  const bitsPerSample = 16;
  const blockAlign = channels * 2;
  const byteRate = sampleRate * blockAlign;
  const dataSize = frameCount * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

function wavResponse(buffer: Buffer): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { audio: { data: buffer.toString('base64') } } }] }),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('XiaomiTextToSpeech', () => {
  test('正确映射 instructions、text、voice、model 和 WAV format', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => wavResponse(buildWav()));
    vi.stubGlobal('fetch', fetchMock);

    const tts = createXiaomiTextToSpeech({ apiKey: 'secret-key' });

    await tts.synthesize({
      text: '你好',
      voice: '冰糖',
      instructions: '轻松一点',
      format: 'wav',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('https://api.xiaomimimo.com/v1/chat/completions');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer secret-key' });

    const body = JSON.parse(init.body as string);

    expect(body.model).toBe('mimo-v2.5-tts');
    expect(body.audio).toEqual({ format: 'wav', voice: '冰糖' });

    expect(body.messages).toEqual([
      { role: 'user', content: '轻松一点' },
      { role: 'assistant', content: '你好' },
    ]);
  });

  test('Base64 音频正确解码并校验 WAV 头', async () => {
    const wav = buildWav();
    const fetchMock = vi.fn(async () => wavResponse(wav));
    vi.stubGlobal('fetch', fetchMock);

    const tts = createXiaomiTextToSpeech({ apiKey: 'secret-key' });

    const result = await tts.synthesize({ text: '你好', voice: '冰糖', format: 'wav' });

    expect(result.format).toBe('wav');
    expect(result.mimeType).toBe('audio/wav');
    expect(result.sampleRate).toBe(24_000);
    expect(result.channels).toBe(1);
    expect(result.data).toEqual(wav);
  });

  test('响应缺少音频数据时明确失败', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [] }),
    }));

    vi.stubGlobal('fetch', fetchMock);

    const tts = createXiaomiTextToSpeech({ apiKey: 'secret-key' });

    await expect(tts.synthesize({ text: '你好', voice: '冰糖', format: 'wav' })).rejects.toThrow(
      '缺少音频数据',
    );
  });

  test('Base64 非法或非 WAV 时失败', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { audio: { data: Buffer.from('not a wav').toString('base64') } } }],
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);

    const tts = createXiaomiTextToSpeech({ apiKey: 'secret-key' });

    await expect(tts.synthesize({ text: '你好', voice: '冰糖', format: 'wav' })).rejects.toThrow(
      '不是有效的 WAV',
    );
  });

  test('AbortSignal 能取消请求', async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('Aborted')), {
            once: true,
          });
        }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const tts = createXiaomiTextToSpeech({ apiKey: 'secret-key' });
    const controller = new AbortController();

    const pending = tts.synthesize({
      text: '你好',
      voice: '冰糖',
      format: 'wav',
      signal: controller.signal,
    });

    controller.abort();

    await expect(pending).rejects.toThrow('Aborted');
  });

  test('错误信息不泄露 API key', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    }));

    vi.stubGlobal('fetch', fetchMock);

    const tts = createXiaomiTextToSpeech({ apiKey: 'super-secret-key' });

    await expect(tts.synthesize({ text: '你好', voice: '冰糖', format: 'wav' })).rejects.toThrow(
      'HTTP 401',
    );

    const body = fetchMock.mock.calls[0]?.[1].body as string;

    expect(body).not.toContain('super-secret-key');
  });
});
