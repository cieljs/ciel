import { expect, test, vi } from 'vite-plus/test';

const { MockASR } = vi.hoisted(() => {
  class MockASR {
    readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    closeCount = 0;
    flushCount = 0;

    constructor(readonly options?: unknown) {}

    write() {}

    flush() {
      this.flushCount += 1;
    }

    on(event: string, callback: (...args: unknown[]) => void) {
      const callbacks = this.listeners.get(event) ?? new Set();

      callbacks.add(callback);
      this.listeners.set(event, callbacks);

      return () => callbacks.delete(callback);
    }

    emit(event: string, value: unknown) {
      for (const callback of this.listeners.get(event) ?? []) {
        callback(value);
      }
    }

    async close() {
      this.closeCount += 1;
    }
  }

  return { MockASR };
});

vi.mock('@cieljs/hearing', () => ({ ASR: MockASR }));

import { createPerception } from '../src/index.ts';
import type { SpeechEndEvent } from '../src/types.ts';

test('speechend publishes a frozen snapshot with the matching ASR result', async () => {
  const perception = createPerception({
    asr: {
      modelsPath: '/models',
      speaker: [{ name: 'alice', file: 'alice.voiceprint' }],
    },
    vision: false,
    context: ({ modality }) => (modality === 'hearing' ? '听觉提示' : undefined),
    retentionMs: 60_000,
  });

  const asr = perception.asr as unknown as InstanceType<typeof MockASR>;
  const published = new Promise<SpeechEndEvent>(resolve => perception.on('speechend', resolve));

  const result = {
    content: '测试内容',
    speaker: 'alice',
    startAt: new Date('2026-09-05T12:00:01.000Z'),
    endAt: new Date('2026-09-05T12:00:02.000Z'),
  };

  asr.emit('result', result);
  asr.emit('speechend', result.endAt);

  const event = await published;
  const messages = await event.snapshot.compose();

  expect(asr.options).toEqual({
    modelsPath: '/models',
    speaker: [{ name: 'alice', file: 'alice.voiceprint' }],
  });

  expect(event.result).toMatchObject({ content: '测试内容', speaker: 'alice' });
  expect(event.snapshot.endAt).toEqual(result.endAt);

  expect(messages).toMatchObject([
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: '# 听觉\n\n听觉提示\n\n时间: 2026-09-05T12:00:01.000Z, 说话人: [alice]\n测试内容',
        },
      ],
    },
  ]);

  result.content = '已修改';

  expect(event.snapshot.transcripts[0]?.content).toBe('测试内容');
});

test('未传入 context 时使用包内默认听觉提示词', async () => {
  const perception = createPerception({ asr: { modelsPath: '/models' }, vision: false });
  const asr = perception.asr as unknown as InstanceType<typeof MockASR>;
  const published = new Promise<SpeechEndEvent>(resolve => perception.on('speechend', resolve));

  const result = {
    content: '测试内容',
    startAt: new Date('2026-09-05T12:00:01.000Z'),
    endAt: new Date('2026-09-05T12:00:02.000Z'),
  };

  asr.emit('result', result);
  asr.emit('speechend', result.endAt);

  const event = await published;
  const messages = await event.snapshot.compose();

  expect(messages).toMatchObject([
    {
      content: [
        {
          type: 'text',
          text: expect.stringContaining('以下是按时间排列的听觉转写'),
        },
      ],
    },
  ]);

  await perception.close();
});

test('speechend still publishes without recognized text and close is idempotent', async () => {
  const perception = createPerception({ asr: { modelsPath: '/models' }, vision: false });
  const asr = perception.asr as unknown as InstanceType<typeof MockASR>;
  const published = new Promise<SpeechEndEvent>(resolve => perception.on('speechend', resolve));

  asr.emit('speechend', new Date('2026-09-05T12:00:02.000Z'));

  const event = await published;

  expect(event.result).toBeUndefined();
  await expect(event.snapshot.compose()).resolves.toEqual([]);

  await perception.close();
  await perception.close();

  expect(asr.flushCount).toBe(1);
  expect(asr.closeCount).toBe(1);
});
