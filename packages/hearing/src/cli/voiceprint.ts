import { access } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import sherpaOnnx from 'sherpa-onnx-node';
import type { SpeakerEmbeddingExtractor as SpeakerEmbeddingExtractorInstance } from 'sherpa-onnx-node';

import { SAMPLE_RATE } from '../constants.ts';
import { createAudioConfig } from '../models.ts';
import { averageEmbeddings, writeVoiceprint } from '../voiceprint.ts';
import { loading } from './utils/index.ts';

const { SpeakerEmbeddingExtractor, readWave } = sherpaOnnx;

export async function createVoiceprint(args: readonly string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      'models-path': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });

  if (values.help) {
    printHelp();

    return;
  }

  const output = values.output;

  if (!output) {
    fail('--output is required');
  }

  const modelsPath = values['models-path'];

  if (!modelsPath) {
    fail('--models-path is required');
  }

  if (positionals.length === 0) {
    fail('at least one WAV sample is required');
  }

  await Promise.all(positionals.map(file => access(file)));

  const stop = loading('Creating voiceprint');

  let result: {
    dimensions: number;
    output: string;
    samples: number;
    type: 'voiceprint';
  };

  try {
    const extractor = new SpeakerEmbeddingExtractor(createAudioConfig(modelsPath).speaker);
    const embeddings = positionals.map(file => computeEmbedding(extractor, file));
    const target = writeVoiceprint(output, averageEmbeddings(embeddings));

    result = {
      type: 'voiceprint',
      output: target,
      samples: positionals.length,
      dimensions: extractor.dim,
    };
  } finally {
    stop();
  }

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function computeEmbedding(
  extractor: SpeakerEmbeddingExtractorInstance,
  file: string,
): Float32Array {
  const wave = readWave(file);

  if (wave.sampleRate !== SAMPLE_RATE) {
    throw new Error(`${file} must use a 16000 Hz sample rate`);
  }

  const stream = extractor.createStream();
  stream.acceptWaveform(wave);

  if (!extractor.isReady(stream)) {
    throw new Error(`${file} is too short to create a voiceprint`);
  }

  return extractor.compute(stream);
}

function printHelp(): void {
  process.stdout.write(
    'Usage: vp run @cieljs/hearing#voiceprint -- --models-path <directory> --output <file> <sample.wav...>\n',
  );
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
