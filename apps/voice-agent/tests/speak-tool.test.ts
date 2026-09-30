import { describe, expect, test, vi } from 'vite-plus/test';

import type { AudioOutput } from '../src/audio/types.ts';
import type { VoiceAgentEvent } from '../src/conversation/scheduler.ts';
import {
  createSpeakTool,
  SpeakController,
  type SpeakToolOptions,
} from '../src/conversation/speak-tool.ts';
import type { SpeechAudio, TextToSpeech } from '../src/tts/types.ts';

interface Harness {
  controller: SpeakController;
  tool: ReturnType<typeof createSpeakTool>;
  synthesizeMock: ReturnType<typeof vi.fn>;
  playMock: ReturnType<typeof vi.fn>;
  setSynthesize(impl: (request: { signal?: AbortSignal }) => Promise<SpeechAudio>): void;
  events: VoiceAgentEvent[];
}

function createHarness(): Harness {
  const controller = new SpeakController();
  const events: VoiceAgentEvent[] = [];

  const synthesizeMock = vi.fn(async () => createAudio());
  const playMock = vi.fn(async () => {});

  const tts: TextToSpeech = {
    id: 'fake',
    synthesize: synthesizeMock,
    close: vi.fn(async () => {}),
  };

  const output: AudioOutput = {
    devices: vi.fn(async () => []),
    play: playMock,
    stop: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };

  const options: SpeakToolOptions = {
    controller,
    tts,
    output,
    voice: '冰糖',
    format: 'wav',
    emit: event => events.push(event),
  };

  return {
    controller,
    tool: createSpeakTool(options),
    synthesizeMock,
    playMock,
    setSynthesize: impl => {
      tts.synthesize = impl as unknown as TextToSpeech['synthesize'];
    },
    events,
  };
}

function createAudio(): SpeechAudio {
  return {
    data: Buffer.alloc(4),
    format: 'wav',
    mimeType: 'audio/wav',
    sampleRate: 24_000,
    channels: 1,
  };
}

describe('speak 工具', () => {
  test('播放完成后返回 delivered', async () => {
    const harness = createHarness();

    harness.controller.beginRun();

    const result = await harness.tool.execute('tool-1', { text: '你好，我是夏尔' }, undefined);

    expect(result.details).toEqual({
      status: 'delivered',
      startedAt: expect.any(String),
      endedAt: expect.any(String),
    });

    expect(harness.playMock).toHaveBeenCalledTimes(1);
  });

  test('开始前已出现新语音返回 superseded', async () => {
    const harness = createHarness();

    harness.controller.beginRun();
    harness.controller.noteSpeech();

    const result = await harness.tool.execute('tool-1', { text: '你好' }, undefined);

    expect(result.details).toEqual({ status: 'superseded', reason: 'new_speech' });
    expect(harness.synthesizeMock).not.toHaveBeenCalled();
  });

  test('同一轮第二次 speak 被拒绝', async () => {
    const harness = createHarness();

    harness.controller.beginRun();

    await harness.tool.execute('tool-1', { text: '第一句' }, undefined);

    await expect(harness.tool.execute('tool-2', { text: '第二句' }, undefined)).rejects.toThrow(
      '只能发言一次',
    );
  });

  test('TTS 期间出现新语音会取消并返回 superseded', async () => {
    const harness = createHarness();

    harness.setSynthesize(
      request =>
        new Promise<SpeechAudio>((_, reject) => {
          request.signal?.addEventListener('abort', () => reject(new Error('Aborted')), {
            once: true,
          });
        }),
    );

    const gate = harness.controller.beginRun();

    const pending = harness.tool.execute('tool-1', { text: '你好' }, undefined);

    await Promise.resolve();
    harness.controller.noteSpeech();

    const result = await pending;

    expect(gate.signal.aborted).toBe(true);
    expect(result.details).toEqual({ status: 'superseded', reason: 'new_speech' });
    expect(harness.playMock).not.toHaveBeenCalled();
  });

  test('speak 无思考运行时抛错', async () => {
    const harness = createHarness();

    await expect(harness.tool.execute('tool-1', { text: '你好' }, undefined)).rejects.toThrow(
      '只能在一次思考运行期间调用',
    );
  });

  test('空白 text 被拒绝', async () => {
    const harness = createHarness();

    harness.controller.beginRun();

    await expect(harness.tool.execute('tool-1', { text: '   ' }, undefined)).rejects.toThrow(
      'text 不能为空',
    );
  });
});
