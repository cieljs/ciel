import sharp from 'sharp';
import { expect, test } from 'vite-plus/test';

import type { StoredPerceptionFrame } from '../src/vision/stream.ts';
import { PerceptionImageStream } from '../src/vision/stream.ts';

test('image sources keep independent sampling and difference state', async () => {
  const frames: StoredPerceptionFrame[] = [];
  const errors: Error[] = [];
  let sequence = 0;

  const stream = new PerceptionImageStream({
    differenceThreshold: 0.03,
    sampleIntervalMs: 1_000,
    nextSequence: () => ++sequence,
    onFrame: frame => frames.push(frame),
    onError: error => errors.push(error),
  });

  const dark = await solidImage(0);
  const light = await solidImage(255);

  await stream.write({ data: dark, at: new Date(1_000), source: 'screen' });
  await stream.write({ data: light, at: new Date(1_500), source: 'screen' });
  await stream.write({ data: dark, at: new Date(1_500), source: 'camera' });
  await stream.write({ data: light, at: new Date(2_000), source: 'screen' });

  expect(errors).toEqual([]);

  expect(frames.map(({ source, at }) => [source, at.getTime()])).toEqual([
    ['screen', 1_000],
    ['camera', 1_500],
    ['screen', 2_000],
  ]);
});

test('unchanged candidates do not replace the accepted-frame difference baseline', async () => {
  const frames: StoredPerceptionFrame[] = [];
  let sequence = 0;

  const stream = new PerceptionImageStream({
    differenceThreshold: 0.1,
    sampleIntervalMs: 0,
    nextSequence: () => ++sequence,
    onFrame: frame => frames.push(frame),
    onError: () => undefined,
  });

  await stream.write({ data: await solidImage(0), at: new Date(1_000) });
  await stream.write({ data: await solidImage(10), at: new Date(2_000) });
  await stream.write({ data: await solidImage(30), at: new Date(3_000) });

  expect(frames.map(frame => frame.at.getTime())).toEqual([1_000, 3_000]);
});

async function solidImage(value: number) {
  return sharp({
    create: {
      width: 32,
      height: 18,
      channels: 3,
      background: { r: value, g: value, b: value },
    },
  })
    .png()
    .toBuffer();
}
