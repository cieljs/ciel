// @env node

import { EventEmitter } from 'node:events';

import { ASR } from '@cieljs/hearing';
import type { ASRResult, Unsubscribe } from '@cieljs/hearing';

import { createDefaultPerceptionContext } from './prompts.ts';
import { createPerceptionSnapshot } from './snapshot.ts';
import type {
  Perception,
  PerceptionEventMap,
  PerceptionOptions,
  PerceptionSnapshot,
  SnapshotOptions,
  SpeechEndEvent,
} from './types.ts';
import { PerceptionImageStream } from './vision/stream.ts';
import type { StoredPerceptionFrame } from './vision/stream.ts';

const DEFAULT_RETENTION_MS = 60_000;
const DEFAULT_SAMPLE_INTERVAL_MS = 6_666;
const DEFAULT_DIFFERENCE_THRESHOLD = 0.03;
const DEFAULT_MAX_FRAMES = 9;

export function createPerception(options: PerceptionOptions): Perception {
  return new PerceptionRuntime(options);
}

class PerceptionRuntime implements Perception {
  readonly asr: ASR;
  readonly image?: PerceptionImageStream;

  private closed = false;
  private readonly emitter = new EventEmitter();
  private readonly frames: StoredPerceptionFrame[] = [];
  private imageSequence = 0;
  private latestObservedAt = Number.NEGATIVE_INFINITY;
  private pendingResult?: ASRResult;
  private publication = Promise.resolve();
  private readonly snapshotWindows = new Set<{ readonly startAt: number }>();
  private readonly transcripts: ASRResult[] = [];
  private readonly unsubscribers: Unsubscribe[] = [];

  private readonly context: PerceptionOptions['context'];
  private readonly maxFrames: number;
  private readonly retentionMs: number;

  constructor(options: PerceptionOptions) {
    const normalized = normalizeOptions(options);

    this.context = options.context ?? createDefaultPerceptionContext;
    this.maxFrames = normalized.maxFrames;
    this.retentionMs = normalized.retentionMs;

    if (normalized.vision) {
      this.image = new PerceptionImageStream({
        differenceThreshold: normalized.vision.differenceThreshold,
        sampleIntervalMs: normalized.vision.sampleIntervalMs,
        nextSequence: () => {
          this.imageSequence += 1;

          return this.imageSequence;
        },
        onFrame: frame => this.addFrame(frame),
        onError: error => this.emitError(error),
      });
    }

    this.asr = new ASR(options.asr);

    this.unsubscribers.push(
      this.asr.on('result', result => this.addTranscript(result)),
      this.asr.on('speechend', at => this.handleSpeechEnd(at)),
      this.asr.on('error', error => this.emitError(error)),
    );
  }

  on<K extends keyof PerceptionEventMap>(event: K, callback: PerceptionEventMap[K]): Unsubscribe {
    this.emitter.on(event, callback);

    return () => this.emitter.off(event, callback);
  }

  async snapshot(options: SnapshotOptions = {}): Promise<PerceptionSnapshot> {
    const endAt = cloneValidDate(options.endAt ?? new Date(), 'snapshot.endAt');

    const startAt = cloneValidDate(
      options.startAt ?? new Date(endAt.getTime() - this.retentionMs),
      'snapshot.startAt',
    );

    if (startAt.getTime() > endAt.getTime()) {
      throw new Error('Snapshot startAt must not be after endAt');
    }

    const sequence = this.imageSequence;
    const barriers = this.image?.barriers() ?? [];

    return this.captureSnapshot(startAt, endAt, sequence, barriers);
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    const imageClosing = this.image?.close();

    await this.asr.flush();
    await this.asr.close();
    await imageClosing;
    await this.publication;

    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
  }

  private addTranscript(result: ASRResult) {
    const transcript = cloneTranscript(result);

    this.pendingResult = transcript;
    this.transcripts.push(transcript);
    this.observe(transcript.endAt.getTime());
  }

  private addFrame(frame: StoredPerceptionFrame) {
    this.frames.push(frame);
    this.observe(frame.at.getTime());
  }

  private handleSpeechEnd(at: Date) {
    const endAt = new Date(at);
    const result = this.pendingResult;
    const sequence = this.imageSequence;
    const barriers = this.image?.barriers() ?? [];
    const startAt = new Date(endAt.getTime() - this.retentionMs);
    const snapshot = this.captureSnapshot(startAt, endAt, sequence, barriers);

    this.pendingResult = undefined;
    this.observe(endAt.getTime());

    const publication = this.publication.then(async () => {
      this.emitSpeechEnd({
        at: new Date(endAt),
        ...(result ? { result: cloneTranscript(result) } : {}),
        snapshot: await snapshot,
      });
    });

    this.publication = publication.catch((error: unknown) => {
      this.emitError(toError(error));
    });
  }

  private async captureSnapshot(
    startAt: Date,
    endAt: Date,
    sequence: number,
    barriers: readonly Promise<void>[],
  ) {
    const window = { startAt: startAt.getTime() };

    this.snapshotWindows.add(window);

    try {
      await Promise.all(barriers);

      return this.freezeSnapshot(startAt, endAt, sequence);
    } finally {
      this.snapshotWindows.delete(window);
      this.prune();
    }
  }

  private freezeSnapshot(startAt: Date, endAt: Date, sequence: number) {
    const start = startAt.getTime();
    const end = endAt.getTime();

    const transcripts = this.transcripts
      .filter(
        transcript => transcript.endAt.getTime() >= start && transcript.endAt.getTime() <= end,
      )
      .sort(compareTranscripts);

    const frames = this.frames
      .filter(frame => {
        const at = frame.at.getTime();

        return frame.sequence <= sequence && at >= start && at <= end;
      })
      .sort(compareFrames);

    return createPerceptionSnapshot({
      startAt,
      endAt,
      transcripts,
      frames,
      context: this.context,
      maxFrames: this.maxFrames,
    });
  }

  private observe(at: number) {
    this.latestObservedAt = Math.max(this.latestObservedAt, at);

    this.prune();
  }

  private prune() {
    let cutoff = this.latestObservedAt - this.retentionMs;

    for (const window of this.snapshotWindows) {
      cutoff = Math.min(cutoff, window.startAt);
    }

    removeBefore(this.transcripts, transcript => transcript.endAt.getTime() < cutoff);
    removeBefore(this.frames, frame => frame.at.getTime() < cutoff);
  }

  private emitSpeechEnd(event: SpeechEndEvent) {
    try {
      this.emitter.emit('speechend', event);
    } catch (error) {
      this.emitError(toError(error));
    }
  }

  private emitError(error: Error) {
    if (this.emitter.listenerCount('error') === 0) {
      return;
    }

    this.emitter.emit('error', error);
  }
}

function normalizeOptions(options: PerceptionOptions) {
  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;

  assertNonNegativeFinite(retentionMs, 'retentionMs');

  if (!options.vision) {
    return {
      retentionMs,
      maxFrames: DEFAULT_MAX_FRAMES,
      vision: undefined,
    };
  }

  const sampleIntervalMs = options.vision.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;
  const differenceThreshold = options.vision.differenceThreshold ?? DEFAULT_DIFFERENCE_THRESHOLD;
  const maxFrames = options.vision.maxFrames ?? DEFAULT_MAX_FRAMES;

  assertNonNegativeFinite(sampleIntervalMs, 'vision.sampleIntervalMs');

  if (!Number.isFinite(differenceThreshold) || differenceThreshold < 0 || differenceThreshold > 1) {
    throw new Error('vision.differenceThreshold must be a finite number between 0 and 1');
  }

  if (!Number.isSafeInteger(maxFrames) || maxFrames < 1 || maxFrames > 9) {
    throw new Error('vision.maxFrames must be an integer between 1 and 9');
  }

  return {
    retentionMs,
    maxFrames,
    vision: {
      sampleIntervalMs,
      differenceThreshold,
    },
  };
}

function assertNonNegativeFinite(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}

function cloneValidDate(value: Date, name: string) {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${name} must be a valid Date`);
  }

  return date;
}

function cloneTranscript(transcript: ASRResult): ASRResult {
  return {
    ...transcript,
    events: transcript.events?.map(event => ({ ...event })),
    startAt: new Date(transcript.startAt),
    endAt: new Date(transcript.endAt),
    tokens: transcript.tokens?.map(token => ({
      ...token,
      startAt: new Date(token.startAt),
      endAt: new Date(token.endAt),
    })),
  };
}

function compareTranscripts(left: ASRResult, right: ASRResult) {
  return left.startAt.getTime() - right.startAt.getTime();
}

function compareFrames(left: StoredPerceptionFrame, right: StoredPerceptionFrame) {
  const difference = left.at.getTime() - right.at.getTime();

  return difference || left.sequence - right.sequence;
}

function removeBefore<T>(values: T[], predicate: (value: T) => boolean) {
  let writeIndex = 0;

  for (const value of values) {
    if (predicate(value)) {
      continue;
    }

    values[writeIndex] = value;
    writeIndex += 1;
  }

  values.length = writeIndex;
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}
