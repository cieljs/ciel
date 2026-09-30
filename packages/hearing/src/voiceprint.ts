// @env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const VOICEPRINT_MAGIC = 'CIELVP01';
const HEADER_SIZE = VOICEPRINT_MAGIC.length + Uint32Array.BYTES_PER_ELEMENT;

export function resolveVoiceprintPath(file: string): string {
  return path.resolve(file);
}

export function readVoiceprint(file: string): Float32Array {
  const data = readFileSync(file);

  if (
    data.length < HEADER_SIZE ||
    data.subarray(0, VOICEPRINT_MAGIC.length).toString() !== VOICEPRINT_MAGIC
  ) {
    throw new Error(`Invalid voiceprint file: ${file}`);
  }

  const dimensions = data.readUInt32LE(VOICEPRINT_MAGIC.length);

  if (data.length !== HEADER_SIZE + dimensions * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error(`Invalid voiceprint dimensions: ${file}`);
  }

  const embedding = new Float32Array(dimensions);

  for (let index = 0; index < dimensions; index += 1) {
    embedding[index] = data.readFloatLE(HEADER_SIZE + index * Float32Array.BYTES_PER_ELEMENT);
  }

  return normalizeEmbedding(embedding);
}

export function writeVoiceprint(file: string, embedding: Float32Array): string {
  const normalized = normalizeEmbedding(embedding);
  const data = Buffer.allocUnsafe(HEADER_SIZE + normalized.length * Float32Array.BYTES_PER_ELEMENT);
  data.write(VOICEPRINT_MAGIC, 0, 'ascii');
  data.writeUInt32LE(normalized.length, VOICEPRINT_MAGIC.length);

  normalized.forEach((value, index) => {
    data.writeFloatLE(value, HEADER_SIZE + index * Float32Array.BYTES_PER_ELEMENT);
  });

  const target = resolveVoiceprintPath(file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, data);

  return target;
}

export function averageEmbeddings(embeddings: readonly Float32Array[]): Float32Array {
  const first = embeddings[0];

  if (!first) {
    throw new Error('At least one embedding is required');
  }

  const average = new Float32Array(first.length);

  for (const embedding of embeddings) {
    if (embedding.length !== average.length) {
      throw new Error('Voiceprint dimensions do not match');
    }

    embedding.forEach((value, index) => {
      average[index] += value / embeddings.length;
    });
  }

  return normalizeEmbedding(average);
}

export function normalizeEmbedding(embedding: Float32Array): Float32Array {
  let squaredNorm = 0;

  for (const value of embedding) {
    squaredNorm += value * value;
  }

  const norm = Math.sqrt(squaredNorm);

  if (!Number.isFinite(norm) || norm === 0) {
    throw new Error('Invalid speaker embedding');
  }

  return Float32Array.from(embedding, value => value / norm);
}
