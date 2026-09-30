import sharp from 'sharp';
import { expect, test } from 'vite-plus/test';

import { createPerceptionSnapshot } from '../src/snapshot.ts';

test('纯声音事件进入听觉提示，并与外部结果对象隔离', async () => {
  const events = [{ type: 'applause' }];

  const snapshot = createPerceptionSnapshot({
    startAt: new Date(0),
    endAt: new Date(1),
    transcripts: [{ content: '', events, startAt: new Date(0), endAt: new Date(1) }],
    frames: [],
    context: ({ modality }) => (modality === 'hearing' ? '听觉提示' : undefined),
    maxFrames: 9,
  });

  events[0]!.type = 'bgm';
  expect(snapshot.transcripts[0]?.events).toEqual([{ type: 'applause' }]);
  const messages = await snapshot.compose();

  expect(messages).toMatchObject([
    {
      content: [{ type: 'text', text: expect.stringContaining('声音事件: applause') }],
    },
  ]);
});

test('compose combines visual blocks before the hearing transcript', async () => {
  const image = await sharp({
    create: {
      width: 32,
      height: 18,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();

  const snapshot = createPerceptionSnapshot({
    startAt: new Date('2026-09-05T11:59:00.000Z'),
    endAt: new Date('2026-09-05T12:00:10.000Z'),
    transcripts: [
      {
        content: '你好',
        speaker: '主播',
        startAt: new Date('2026-09-05T12:00:04.000Z'),
        endAt: new Date('2026-09-05T12:00:05.000Z'),
      },
    ],
    frames: [
      {
        source: 'livestream',
        at: new Date('2026-09-05T12:00:01.000Z'),
        data: image,
        mimeType: 'image/png',
      },
    ],
    context: ({ modality }) => (modality === 'vision' ? '视觉提示' : '听觉提示'),
    maxFrames: 9,
  });

  const messages = await snapshot.compose();

  expect(messages).toHaveLength(1);

  expect(messages[0]).toMatchObject({
    role: 'user',
    timestamp: new Date('2026-09-05T12:00:10.000Z').getTime(),
    content: [
      { type: 'text', text: '# 视觉\n\n视觉提示' },
      { type: 'image', mimeType: 'image/jpeg' },
      {
        type: 'text',
        text: '# 听觉\n\n听觉提示\n\n时间: 2026-09-05T12:00:04.000Z, 说话人: [主播]\n你好',
      },
    ],
  });

  const message = messages[0];

  if (!message || message.role !== 'user' || typeof message.content === 'string') {
    throw new Error('Expected one multimodal user message');
  }

  const imageContent = message.content.find(content => content.type === 'image');

  if (!imageContent) {
    throw new Error('Expected a composed image block');
  }

  const metadata = await sharp(Buffer.from(imageContent.data, 'base64')).metadata();

  expect(metadata).toMatchObject({ format: 'jpeg', width: 1920, height: 1080 });
});

test('compose omits empty modalities and does not create prompt-only messages', async () => {
  const snapshot = createPerceptionSnapshot({
    startAt: new Date(0),
    endAt: new Date(1),
    transcripts: [],
    frames: [],
    context: () => '不应调用',
    maxFrames: 9,
  });

  await expect(snapshot.compose()).resolves.toEqual([]);
});
