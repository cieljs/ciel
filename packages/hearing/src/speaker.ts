// @env node

import type { SpeakerEmbeddingExtractor } from 'sherpa-onnx-node';

import type { SpeakerProfile } from './types.ts';
import { normalizeEmbedding, readVoiceprint } from './voiceprint.ts';

interface SpeakerCenter {
  embedding: Float32Array;
  label: string;
  registered: boolean;
  updates: number;
}

export class SpeakerTracker {
  private readonly centers: SpeakerCenter[] = [];
  private dynamicSpeakers = 0;
  private nextDynamicId = 0;

  constructor(
    private readonly extractor: SpeakerEmbeddingExtractor,
    profiles: readonly SpeakerProfile[],
    private readonly threshold: number,
    private readonly maxSpeakers: number,
  ) {
    for (const profile of profiles) {
      if (!profile.name.trim()) {
        throw new Error('Speaker name cannot be empty');
      }

      if (this.centers.some(center => center.label === profile.name)) {
        throw new Error(`Duplicate speaker name: ${profile.name}`);
      }

      const embedding = readVoiceprint(profile.file);

      if (embedding.length !== extractor.dim) {
        throw new Error(`Voiceprint dimensions do not match speaker model: ${profile.file}`);
      }

      this.centers.push({
        embedding,
        label: profile.name,
        registered: true,
        updates: 1,
      });
    }
  }

  assign(samples: Float32Array, sampleRate: number): string {
    const stream = this.extractor.createStream();
    stream.acceptWaveform({ samples, sampleRate });

    if (!this.extractor.isReady(stream)) {
      const minimumSamples = sampleRate * 3;

      if (samples.length < minimumSamples) {
        stream.acceptWaveform({
          samples: new Float32Array(minimumSamples - samples.length),
          sampleRate,
        });
      }
    }

    if (!this.extractor.isReady(stream)) {
      throw new Error('Speech segment cannot produce a speaker embedding');
    }

    const embedding = normalizeEmbedding(this.extractor.compute(stream));

    if (this.centers.length === 0) {
      return this.createDynamicSpeaker(embedding);
    }

    let bestIndex = 0;
    let bestSimilarity = Number.NEGATIVE_INFINITY;

    this.centers.forEach((center, index) => {
      const similarity = cosineSimilarity(embedding, center.embedding);

      if (similarity > bestSimilarity) {
        bestIndex = index;
        bestSimilarity = similarity;
      }
    });

    if (bestSimilarity < this.threshold && this.dynamicSpeakers < this.maxSpeakers) {
      return this.createDynamicSpeaker(embedding);
    }

    const center = this.centers[bestIndex]!;

    if (!center.registered) {
      this.updateCenter(center, embedding);
    }

    return center.label;
  }

  private createDynamicSpeaker(embedding: Float32Array): string {
    let label = `speaker_${this.nextDynamicId}`;

    while (this.centers.some(center => center.label === label)) {
      this.nextDynamicId += 1;
      label = `speaker_${this.nextDynamicId}`;
    }

    this.nextDynamicId += 1;
    this.dynamicSpeakers += 1;

    this.centers.push({
      embedding,
      label,
      registered: false,
      updates: 1,
    });

    return label;
  }

  private updateCenter(center: SpeakerCenter, embedding: Float32Array): void {
    const weight = 1 / Math.min(center.updates + 1, 20);

    const updated = Float32Array.from(
      center.embedding,
      (value, index) => (1 - weight) * value + weight * embedding[index]!,
    );

    center.embedding = normalizeEmbedding(updated);
    center.updates += 1;
  }
}

function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) {
    throw new Error('Speaker embedding dimensions do not match');
  }

  let similarity = 0;

  for (let index = 0; index < left.length; index += 1) {
    similarity += left[index]! * right[index]!;
  }

  return similarity;
}
