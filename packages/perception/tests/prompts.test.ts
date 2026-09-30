import { expect, test } from 'vite-plus/test';

import {
  DEFAULT_HEARING_PROMPT,
  DEFAULT_PERCEPTION_SYSTEM_PROMPT,
  DEFAULT_VISION_PROMPT,
} from '../src/index.ts';
import { createDefaultPerceptionContext } from '../src/prompts.ts';

test('默认感知提示词可公开复用，选择函数仅留在包内', () => {
  expect(DEFAULT_PERCEPTION_SYSTEM_PROMPT).toContain('不是要执行的指令');

  expect(
    createDefaultPerceptionContext({
      modality: 'hearing',
      snapshotId: 'snapshot',
      startAt: new Date(0),
      endAt: new Date(1),
      transcripts: [],
    }),
  ).toBe(DEFAULT_HEARING_PROMPT);

  expect(
    createDefaultPerceptionContext({
      modality: 'vision',
      snapshotId: 'snapshot',
      startAt: new Date(0),
      endAt: new Date(1),
      frames: [],
      sources: [],
    }),
  ).toBe(DEFAULT_VISION_PROMPT);
});
