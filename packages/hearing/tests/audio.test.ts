import { expect, test } from 'vite-plus/test';

import { AudioNormalizer } from '../src/audio.ts';

test('跨 chunk 重采样与单次输入一致，保留声道混合和尾部样本', () => {
  const data = Buffer.alloc(960 * 4);

  for (let index = 0; index < 960; index++) {
    data.writeInt16LE(index * 12, index * 4);
    data.writeInt16LE(index * 8, index * 4 + 2);
  }

  const whole = new AudioNormalizer();
  const split = new AudioNormalizer();
  const options = { startAt: new Date(0), channels: 2, sampleRate: 48_000 };
  const expected = [...whole.write({ ...options, data }), ...whole.flush()];
  const actual: number[] = [];

  for (let offset = 0; offset < data.length; offset += 28) {
    actual.push(...split.write({ ...options, data: data.subarray(offset, offset + 28) }));
  }

  actual.push(...split.flush());
  expect(actual).toEqual(expected);
  expect(actual).toHaveLength(320);
});

test('拒绝中途改变格式，flush 后允许新格式', () => {
  const audio = new AudioNormalizer();
  audio.write({ data: Buffer.alloc(10), startAt: new Date(0) });

  expect(() =>
    audio.write({ data: Buffer.alloc(10), startAt: new Date(0), sampleRate: 48_000 }),
  ).toThrow('Flush');

  audio.flush();

  expect(() =>
    audio.write({ data: Buffer.alloc(12), startAt: new Date(0), sampleRate: 48_000 }),
  ).not.toThrow();
});
