import { beforeEach, expect, test, vi } from 'vite-plus/test';

import type { ASRStream, ASRSegment } from '../src/types.ts';
import { WakeGate } from '../src/wake-gate.ts';

const state = vi.hoisted(() => ({
  wakeAt: 200,
  listener: (_event: { at: Date; keyword: string }) => {},
  writes: 0,
}));

vi.mock('../src/kws.ts', () => ({
  KWS: class {
    on(_event: string, listener: typeof state.listener) {
      state.listener = listener;
    }
    write(chunk: ASRSegment) {
      state.writes++;

      if (chunk.startAt.getTime() === state.wakeAt) {
        state.listener({ at: chunk.startAt, keyword: '夏尔' });
      }
    }
    flush() {}
    async close() {}
  },
}));

beforeEach(() => {
  state.wakeAt = 200;
  state.writes = 0;
});

function backend() {
  const writes: ASRSegment[] = [];

  let end = () => {};

  const stream: Pick<ASRStream, 'write' | 'flush' | 'on' | 'close'> = {
    write: chunk => {
      writes.push(chunk);
    },
    flush: vi.fn(),
    close: vi.fn(async () => {}),
    on: (event, listener) => {
      if (event === 'speechend') {
        end = () => (listener as (at: Date) => void)(new Date(0));
      }

      return () => {};
    },
  };

  return { stream, writes, end: () => end() };
}

test('待机不转写，唤醒时回放缓存，达到最长聆听时间重新待机', async () => {
  const { stream, writes } = backend();

  const gate = new WakeGate(stream, {
    modelsPath: '/models',
    keywords: ['夏尔'],
    preRollMs: 200,
    maxListenMs: 200,
  });

  await gate.write({ data: Buffer.alloc(32_000), startAt: new Date(0) });
  expect(state.writes).toBe(10);
  expect(writes.map(chunk => chunk.startAt.getTime())).toEqual([0, 100, 200, 300]);
  expect(stream.flush).toHaveBeenCalledTimes(1);
  await gate.close();
});

test('没有唤醒时 flush 不把缓存交给 ASR', async () => {
  state.wakeAt = -1;
  const { stream, writes } = backend();
  const gate = new WakeGate(stream, { modelsPath: '/models', keywords: ['夏尔'] });
  await gate.write({ data: Buffer.alloc(32_000), startAt: new Date(0) });
  await gate.flush();
  expect(writes).toEqual([]);
  const closing = gate.close();
  expect(gate.close()).toBe(closing);
  await closing;
});
