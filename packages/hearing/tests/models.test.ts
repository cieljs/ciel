import { describe, expect, it } from 'vite-plus/test';

import { createAudioConfig } from '../src/models.ts';
import { createQwen3Config } from '../src/models/qwen3.ts';

describe('createAudioConfig', () => {
  it('使用 Qwen3-ASR-1.7B INT8 与 TEN-VAD', () => {
    const config = createAudioConfig('/models');

    expect(createQwen3Config('/models').modelConfig?.qwen3Asr).toMatchObject({
      hotwords: '',
      maxNewTokens: 64,
      maxTotalLen: 512,
    });

    expect(createQwen3Config('/models').modelConfig?.qwen3Asr?.convFrontend).toMatch(
      /conv_frontend\.onnx$/,
    );

    expect(createQwen3Config('/models').modelConfig?.qwen3Asr?.encoder).toMatch(
      /encoder\.int8\.onnx$/,
    );

    expect(createQwen3Config('/models').modelConfig?.qwen3Asr?.decoder).toMatch(
      /decoder\.int8\.onnx$/,
    );

    expect(createQwen3Config('/models').modelConfig?.qwen3Asr?.tokenizer).toMatch(/tokenizer$/);
    expect(config.vad.sileroVad).toBeUndefined();

    expect(config.vad.tenVad).toMatchObject({
      threshold: 0.25,
      minSilenceDuration: 0.5,
      minSpeechDuration: 0.5,
      windowSize: 256,
      maxSpeechDuration: 10,
    });

    expect(config.vad.tenVad?.model).toMatch(/ten-vad\.int8\.onnx$/);
  });

  it('使用调用方提供的模型目录', () => {
    const first = createAudioConfig('C:\\ciel-first\\models');
    const second = createAudioConfig('C:\\ciel-second\\models');

    expect(first.vad.tenVad?.model).toContain('ciel-first');
    expect(second.vad.tenVad?.model).toContain('ciel-second');
  });
});
