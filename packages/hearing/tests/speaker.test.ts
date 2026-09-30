import type { SpeakerEmbeddingExtractor } from 'sherpa-onnx-node';
import { describe, expect, it } from 'vite-plus/test';

import { SpeakerTracker } from '../src/speaker.ts';

describe('SpeakerTracker', () => {
  it('assigns stable labels and creates new anonymous speakers', () => {
    const extractor = createExtractor([
      Float32Array.of(1, 0),
      Float32Array.of(0.99, 0.01),
      Float32Array.of(0, 1),
    ]);

    const tracker = new SpeakerTracker(extractor, [], 0.8, 4);
    const samples = new Float32Array(48_000);

    expect([
      tracker.assign(samples, 16_000),
      tracker.assign(samples, 16_000),
      tracker.assign(samples, 16_000),
    ]).toEqual(['speaker_0', 'speaker_0', 'speaker_1']);
  });
});

function createExtractor(embeddings: Float32Array[]): SpeakerEmbeddingExtractor {
  return {
    dim: 2,
    config: {},
    createStream: () =>
      ({
        acceptWaveform: () => undefined,
        inputFinished: () => undefined,
      }) as never,
    isReady: () => true,
    compute: () => embeddings.shift()!,
  } as SpeakerEmbeddingExtractor;
}
