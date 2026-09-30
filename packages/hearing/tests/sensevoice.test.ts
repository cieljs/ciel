import { expect, test } from 'vite-plus/test';

import { parseSenseVoiceResult } from '../src/models/sensevoice.ts';

test('保留原生结构化标签，纯事件可以没有文本', () => {
  expect(
    parseSenseVoiceResult({
      text: '',
      lang: '<|nospeech|>',
      emotion: '<|NEUTRAL|>',
      event: '<|Applause|>',
    }),
  ).toEqual({
    content: '',
    language: 'nospeech',
    emotion: 'neutral',
    events: [{ type: 'applause' }],
  });
});

test('解析原始特殊 token，不制造置信度或事件时间区间', () => {
  const result = parseSenseVoiceResult({
    text: '<|zh|><|HAPPY|><|Speech|>你好<|BGM|>',
    lang: '',
    emotion: '',
    event: '',
  });

  expect(result).toEqual({
    content: '你好',
    language: 'zh',
    emotion: 'happy',
    events: [{ type: 'speech' }, { type: 'bgm' }],
  });
});
