// @env node

import { stat } from 'node:fs/promises';

import type { SpeakerEmbeddingExtractorConfig, VadConfig } from 'sherpa-onnx-node';

import { SAMPLE_RATE, resolveModelPaths } from './constants.ts';
import { modelFiles } from './registry.ts';
import type { ASROptions } from './types.ts';

interface ModelConfig {
  vad: VadConfig;
  speaker: SpeakerEmbeddingExtractorConfig;
}

export interface ConfigurationCheck {
  readonly modelsPath: string;
  readonly missingFiles: readonly string[];
  readonly valid: boolean;
}

export function createAudioConfig(modelsPath: string, vad: ASROptions['vad'] = {}): ModelConfig {
  const paths = resolveModelPaths(modelsPath);

  return {
    vad: {
      tenVad: {
        model: paths.vad,
        threshold: 0.25,
        minSpeechDuration: 0.5,
        minSilenceDuration: vad.minSilenceDuration ?? 0.5,
        windowSize: 256,
        maxSpeechDuration: vad.maxSpeechDuration ?? 10,
      },
      sampleRate: SAMPLE_RATE,
      numThreads: 1,
      provider: 'cpu',
    },
    speaker: {
      model: paths.speaker,
      numThreads: 1,
      provider: 'cpu',
    },
  };
}

export async function checkConfiguration(
  options: Pick<ASROptions, 'modelsPath' | 'model' | 'speaker' | 'mode'>,
): Promise<ConfigurationCheck> {
  const requiredFiles = modelFiles(options).map(file => file.target);

  const fileStates = await Promise.all(requiredFiles.map(file => exists(file)));

  const missingFiles = requiredFiles.filter((_file, index) => !fileStates[index]);

  return {
    modelsPath: options.modelsPath,
    missingFiles,
    valid: missingFiles.length === 0,
  };
}

async function exists(file: string): Promise<boolean> {
  try {
    const info = await stat(file);

    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}
