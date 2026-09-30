import path from 'node:path';

import sherpaOnnx from 'sherpa-onnx-node';
import type {
  OfflineRecognizer as OfflineRecognizerInstance,
  OfflineRecognizerResult,
} from 'sherpa-onnx-node';

import { SAMPLE_RATE } from '../constants.ts';

export class SenseVoiceRecognizer {
  private readonly runtime: OfflineRecognizerInstance;

  constructor(modelsPath: string) {
    this.runtime = new sherpaOnnx.OfflineRecognizer({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        senseVoice: {
          model: path.join(modelsPath, 'asr/sensevoice-small/model.int8.onnx'),
          language: 'auto',
          useInverseTextNormalization: 1,
        },
        tokens: path.join(modelsPath, 'asr/sensevoice-small/tokens.txt'),
        numThreads: 2,
        provider: 'cpu',
      },
    });
  }

  transcribe(samples: Float32Array) {
    const stream = this.runtime.createStream();
    stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
    this.runtime.decode(stream);

    return parseSenseVoiceResult(this.runtime.getResult(stream));
  }
}

export function parseSenseVoiceResult(
  result: Pick<OfflineRecognizerResult, 'text' | 'lang' | 'emotion' | 'event'>,
) {
  const tags = [...result.text.matchAll(/<\|([^|]+)\|>/gu)].map(match => match[1]!);

  const language =
    normalizeTag(result.lang) || tags.find(tag => /^(zh|en|ja|ko|yue|nospeech)$/u.test(tag));

  const emotion =
    normalizeTag(result.emotion) ||
    tags
      .find(tag => /^(NEUTRAL|HAPPY|SAD|ANGRY|FEARFUL|DISGUSTED|SURPRISED|EMO_UNKNOWN)$/u.test(tag))
      ?.toLowerCase();

  const event = normalizeTag(result.event);

  const events = event
    ? [event]
    : tags
        .filter(tag => /^(Speech|BGM|Applause|Laughter|Cry|Sneeze|Breath|Cough)$/u.test(tag))
        .map(tag => tag.toLowerCase());

  return {
    content: result.text.replace(/<\|[^|]+\|>/gu, '').trim(),
    language: language || undefined,
    emotion: emotion || undefined,
    events: [...new Set(events)].map(type => ({ type })),
  };
}

function normalizeTag(value: string | undefined) {
  return (value ?? '')
    .replace(/^<\||\|>$/gu, '')
    .trim()
    .toLowerCase();
}
