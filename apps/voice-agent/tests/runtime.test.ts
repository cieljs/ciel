import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  fauxAssistantMessage,
  fauxToolCall,
  registerFauxProvider,
} from '@earendil-works/pi-ai/compat';
import type { Perception } from 'cieljs/perception';
import { afterEach, describe, expect, test, vi } from 'vite-plus/test';

import type { AudioInput, AudioOutput } from '../src/audio/types.ts';
import { defaultVoiceAgentConfig } from '../src/config.ts';
import type { VoiceAgentEvent } from '../src/conversation/scheduler.ts';
import { createVoiceAgent } from '../src/runtime.ts';
import type { SpeechAudio, TextToSpeech } from '../src/tts/types.ts';

const { qwen } = vi.hoisted(() => ({
  qwen: vi.fn(() => ({
    model: 'test-embedding',
    dimensions: 2,
    batchSize: 32,
    embed: async () => [1, 0],
    embedBatch: async (texts: string[]) => texts.map(() => [1, 0]),
  })),
}));

vi.mock('cieljs/embed', () => ({ qwen }));

vi.mock('cieljs/perception', () => ({
  createPerception: () => {
    throw new Error('createPerception 不应在测试中被调用');
  },
}));

vi.mock('decibri', () => ({
  Microphone: class {
    static open() {
      throw new Error('decibri.Microphone 不应在测试中被调用');
    }
    static devices() {
      return [];
    }
  },
  Speaker: class {
    static open() {
      throw new Error('decibri.Speaker 不应在测试中被调用');
    }
    static devices() {
      return [];
    }
  },
}));

const temporaryDirectories: string[] = [];

const testConfig = {
  ...defaultVoiceAgentConfig,
  mcp: {
    enabled: false,
  },
};

async function createDataDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'voice-agent-'));
  temporaryDirectories.push(root);

  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(directory =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );

  vi.unstubAllGlobals();
});

function createFakePerception() {
  const listeners = new Map<string, (event: unknown) => void>();

  const perception = {
    asr: { write: vi.fn() },
    on: vi.fn((event: string, callback: (event: unknown) => void) => {
      listeners.set(event, callback);

      return () => listeners.delete(event);
    }),
    emit(event: string, payload: unknown) {
      listeners.get(event)?.(payload);
    },
    snapshot: vi.fn(async (options?: { startAt?: Date; endAt?: Date }) => ({
      id: 'snapshot',
      startAt: options?.startAt ?? new Date(),
      endAt: options?.endAt ?? new Date(),
      transcripts: [],
      frames: [],
      compose: async () => [
        {
          role: 'user' as const,
          content: '[2026-01-01T00:00:00.000Z][speaker_1] 你好',
          timestamp: Date.now(),
        },
      ],
    })),
    close: vi.fn(async () => {}),
  };

  return perception as unknown as Perception & { emit(event: string, payload: unknown): void };
}

function createFakeInput(): AudioInput {
  return {
    devices: vi.fn(async () => [
      {
        index: 0,
        id: 'wasapi:{test-input}',
        name: '默认输入',
        defaultSampleRate: 48_000,
        isDefault: true,
        maxInputChannels: 1,
      },
    ]),
    start: async function* () {},
    pushAecReference: vi.fn(),
    close: vi.fn(async () => {}),
  };
}

function createFakeOutput() {
  return {
    devices: vi.fn(async () => [
      {
        index: 0,
        id: 'wasapi:{test-output}',
        name: '默认输出',
        defaultSampleRate: 48_000,
        isDefault: true,
        maxOutputChannels: 2,
      },
    ]),
    play: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

function createFakeTts() {
  const synthesizeMock = vi.fn(async (): Promise<SpeechAudio> => ({
    data: Buffer.alloc(0),
    format: 'wav',
    mimeType: 'audio/wav',
  }));

  const tts: TextToSpeech = {
    id: 'fake',
    synthesize: synthesizeMock,
    close: vi.fn(async () => {}),
  };

  return { tts, synthesizeMock };
}

describe('createVoiceAgent', () => {
  test('speechend 触发思考并通过 speak 工具完成播放', async () => {
    const dataDir = await createDataDir();
    const faux = registerFauxProvider();

    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('speak', { text: '你好，我是夏尔' })]),
      fauxAssistantMessage('好的'),
    ]);

    const events: VoiceAgentEvent[] = [];
    const perception = createFakePerception();
    const output = createFakeOutput();
    const { tts, synthesizeMock } = createFakeTts();

    const voiceAgent = createVoiceAgent({
      config: testConfig,
      model: faux.getModel(),
      dataDir,
      input: createFakeInput(),
      output: output as AudioOutput,
      tts,
      perception,
    });

    voiceAgent.onEvent(event => events.push(event));

    await voiceAgent.start();
    expect(voiceAgent.status).toBe('running');

    const at = new Date('2026-01-01T00:00:01.000Z');

    perception.emit('speechend', {
      at,
      result: { content: '你好', speaker: 'speaker_1', startAt: at, endAt: at },
    });

    await vi.waitFor(() => {
      expect(output.play).toHaveBeenCalledTimes(1);
    });

    expect(synthesizeMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: '你好，我是夏尔' }),
    );

    expect(events.some(event => event.type === 'playback_finished')).toBe(true);
    expect(events.some(event => event.type === 'think_finished' && event.spoke)).toBe(true);

    await voiceAgent.close();
    await voiceAgent.close();
    expect(voiceAgent.status).toBe('closed');

    faux.unregister();
  }, 30_000);

  test('缺少 XIAOMI_API_KEY 时启动失败', async () => {
    const dataDir = await createDataDir();
    const faux = registerFauxProvider();
    const previous = process.env.XIAOMI_API_KEY;

    delete process.env.XIAOMI_API_KEY;

    const voiceAgent = createVoiceAgent({
      config: testConfig,
      model: faux.getModel(),
      dataDir,
      input: createFakeInput(),
      output: createFakeOutput() as AudioOutput,
      perception: createFakePerception(),
    });

    await expect(voiceAgent.start()).rejects.toThrow('XIAOMI_API_KEY');

    process.env.XIAOMI_API_KEY = previous;
    faux.unregister();
  }, 30_000);

  test('显式输入设备不存在时启动失败', async () => {
    const dataDir = await createDataDir();
    const faux = registerFauxProvider();

    const voiceAgent = createVoiceAgent({
      config: {
        ...testConfig,
        audio: {
          ...testConfig.audio,
          input: { ...testConfig.audio.input, device: 42 },
        },
      },
      model: faux.getModel(),
      dataDir,
      tts: createFakeTts().tts,
      perception: createFakePerception(),
    });

    await expect(voiceAgent.start()).rejects.toThrow('输入设备不存在');

    faux.unregister();
  }, 30_000);
});
