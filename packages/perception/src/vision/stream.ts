// @env node

import sharp from 'sharp';

import type { ImageInput, ImageStream, PerceptionFrame } from '../types.ts';
import { VisionDiffer } from './differ.ts';

export interface StoredPerceptionFrame extends PerceptionFrame {
  readonly sequence: number;
}

interface SourceState {
  readonly differ: VisionDiffer;
  processing: Promise<void>;
  lastSampleAt?: number;
}

interface VisionStreamOptions {
  readonly differenceThreshold: number;
  readonly sampleIntervalMs: number;
  readonly nextSequence: () => number;
  readonly onError: (error: Error) => void;
  readonly onFrame: (frame: StoredPerceptionFrame) => void;
}

export class PerceptionImageStream implements ImageStream {
  private closed = false;
  private readonly sources = new Map<string, SourceState>();

  constructor(private readonly options: VisionStreamOptions) {}

  write(input: ImageInput): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('Perception image stream is closed'));
    }

    validateImageInput(input);

    const source = input.source ?? 'default';
    const state = this.getSource(source);
    const sequence = this.options.nextSequence();

    const accepted = {
      data: Buffer.from(input.data),
      at: new Date(input.at),
      source,
      sequence,
    };

    const processing = state.processing.then(() => this.process(state, accepted));

    state.processing = processing.catch(() => undefined);

    return processing.catch((error: unknown) => {
      const normalized = toError(error);
      this.options.onError(normalized);
      throw normalized;
    });
  }

  barriers(): readonly Promise<void>[] {
    return Array.from(this.sources.values(), state => state.processing);
  }

  async close(): Promise<void> {
    this.closed = true;

    await Promise.all(this.barriers());
  }

  private getSource(source: string) {
    const existing = this.sources.get(source);

    if (existing) {
      return existing;
    }

    const state: SourceState = {
      differ: new VisionDiffer(this.options.differenceThreshold),
      processing: Promise.resolve(),
    };

    this.sources.set(source, state);

    return state;
  }

  private async process(
    state: SourceState,
    input: ImageInput & { readonly source: string; readonly sequence: number },
  ) {
    const sampledAt = input.at.getTime();
    const lastSampleAt = state.lastSampleAt;

    const isTooEarly =
      lastSampleAt !== undefined &&
      (sampledAt <= lastSampleAt || sampledAt - lastSampleAt < this.options.sampleIntervalMs);

    if (isTooEarly) {
      return;
    }

    const difference = await state.differ.evaluate(input.data);
    state.lastSampleAt = sampledAt;

    if (!difference.changed) {
      return;
    }

    const data = await sharp(input.data).jpeg({ quality: 85 }).toBuffer();

    difference.commit();

    this.options.onFrame({
      source: input.source,
      at: new Date(input.at),
      data,
      mimeType: 'image/jpeg',
      sequence: input.sequence,
    });
  }
}

function validateImageInput(input: ImageInput) {
  if (!Buffer.isBuffer(input.data) || input.data.length === 0) {
    throw new Error('Image data must be a non-empty Buffer');
  }

  if (!Number.isFinite(input.at.getTime())) {
    throw new Error('Image at must be a valid Date');
  }

  if (input.source !== undefined && input.source.length === 0) {
    throw new Error('Image source must not be empty');
  }
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}
