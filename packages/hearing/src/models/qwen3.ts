import path from 'node:path';

import sherpaOnnx from 'sherpa-onnx-node';
import type {
  OfflineRecognizer as OfflineRecognizerInstance,
  OfflineRecognizerConfig,
  OfflineRecognizerResult,
} from 'sherpa-onnx-node';

import {
  SAMPLE_RATE,
  ASR_CONV_FRONTEND,
  ASR_ENCODER,
  ASR_DECODER,
  TOKENIZER_DIR,
  resolveModelPaths,
} from '../constants.ts';

const QWEN3_ASR_TEXT_MARKER = '<asr_text>';
const MAX_TRANSCRIPTION_RETRY_DEPTH = 2;
const MIN_TRANSCRIPTION_RETRY_SAMPLES = SAMPLE_RATE * 4;

export class Qwen3Recognizer {
  private runtime: OfflineRecognizerInstance;
  private readonly maxNewTokens = 64;
  constructor(modelsPath: string) {
    this.runtime = new sherpaOnnx.OfflineRecognizer(createQwen3Config(modelsPath));
  }
  transcribe(samples: Float32Array) {
    return { content: this.recognize(samples) };
  }
  recognize(samples: Float32Array, depth = 0): string {
    const stream = this.runtime.createStream();

    stream.acceptWaveform({
      samples,
      sampleRate: SAMPLE_RATE,
    });

    this.runtime.decode(stream);
    const result = this.runtime.getResult(stream);
    const content = parseQwen3AsrText(result.text);

    if (!isDegenerateResult(result, content, this.maxNewTokens)) {
      return content;
    }

    if (
      depth >= MAX_TRANSCRIPTION_RETRY_DEPTH ||
      samples.length < MIN_TRANSCRIPTION_RETRY_SAMPLES
    ) {
      return '';
    }

    const midpoint = Math.floor(samples.length / 2);

    return joinTranscriptParts([
      this.recognize(samples.subarray(0, midpoint), depth + 1),
      this.recognize(samples.subarray(midpoint), depth + 1),
    ]);
  }
}

function parseQwen3AsrText(text: string): string {
  const marker = text.indexOf(QWEN3_ASR_TEXT_MARKER);

  return (marker < 0 ? text : text.slice(marker + QWEN3_ASR_TEXT_MARKER.length)).trim();
}

function isDegenerateResult(
  result: OfflineRecognizerResult,
  content: string,
  maxNewTokens: number,
): boolean {
  return result.tokens.length >= maxNewTokens || hasExcessiveRepetition(content);
}

function hasExcessiveRepetition(content: string): boolean {
  const characters = Array.from(content.normalize().replaceAll(/[\s\p{P}\p{S}]+/gu, ''));

  if (characters.length < 32) {
    return false;
  }

  for (let unitLength = 1; unitLength <= 8; unitLength += 1) {
    const unitStart = characters.length - unitLength;
    const unit = characters.slice(unitStart).join('');
    let repeats = 1;

    for (let cursor = unitStart - unitLength; cursor >= 0; cursor -= unitLength) {
      if (characters.slice(cursor, cursor + unitLength).join('') !== unit) {
        break;
      }

      repeats += 1;
    }

    if (repeats >= 8 && repeats * unitLength >= characters.length / 2) {
      return true;
    }
  }

  return false;
}

function joinTranscriptParts(parts: readonly string[]): string {
  return parts.filter(Boolean).reduce((combined, part) => {
    if (!combined) {
      return part;
    }

    const separator =
      /[\p{Script=Han}\p{P}]$/u.test(combined) || /^[\p{Script=Han}\p{P}]/u.test(part) ? '' : ' ';

    return `${combined}${separator}${part}`;
  }, '');
}

export function createQwen3Config(modelsPath: string): OfflineRecognizerConfig {
  const paths = resolveModelPaths(modelsPath);

  return {
    featConfig: {
      sampleRate: SAMPLE_RATE,
      featureDim: 80,
    },
    modelConfig: {
      qwen3Asr: {
        convFrontend: path.join(paths.asr, ASR_CONV_FRONTEND),
        encoder: path.join(paths.asr, ASR_ENCODER),
        decoder: path.join(paths.asr, ASR_DECODER),
        tokenizer: path.join(paths.asr, TOKENIZER_DIR),
        hotwords: '',
        maxTotalLen: 512,
        // 在 sherpa 的 65-token 重复保护前触发现有退化重试
        maxNewTokens: 64,
        temperature: 0.000_001,
        topP: 0.8,
        seed: 42,
      },
      tokens: '',
      numThreads: 2,
      provider: 'cpu',
    },
  };
}
