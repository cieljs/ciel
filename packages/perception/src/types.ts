import type { ASR, ASROptions, ASRResult, Unsubscribe } from '@cieljs/hearing';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

export interface PerceptionOptions {
  readonly asr: ASROptions;
  readonly vision?: false | VisionOptions;
  readonly context?: PerceptionContext;
  readonly retentionMs?: number;
}

export type PerceptionContext = (
  input: PerceptionContextInput,
) => string | undefined | Promise<string | undefined>;

export type PerceptionContextInput = VisionPerceptionContext | HearingPerceptionContext;

interface PerceptionContextBase {
  readonly snapshotId: string;
  readonly startAt: Date;
  readonly endAt: Date;
}

export interface VisionPerceptionContext extends PerceptionContextBase {
  readonly modality: 'vision';
  readonly frames: readonly PerceptionFrame[];
  readonly sources: readonly string[];
}

export interface HearingPerceptionContext extends PerceptionContextBase {
  readonly modality: 'hearing';
  readonly transcripts: readonly ASRResult[];
}

export interface VisionOptions {
  readonly sampleIntervalMs?: number;
  readonly differenceThreshold?: number;
  readonly maxFrames?: number;
}

export interface ImageInput {
  readonly data: Buffer;
  readonly at: Date;
  readonly source?: string;
}

export interface ImageStream {
  write(input: ImageInput): Promise<void>;
}

export interface SnapshotOptions {
  readonly startAt?: Date;
  readonly endAt?: Date;
}

export interface PerceptionSnapshot {
  readonly id: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly transcripts: readonly ASRResult[];
  readonly frames: readonly PerceptionFrame[];

  compose(): Promise<AgentMessage[]>;
}

export interface PerceptionFrame {
  readonly source: string;
  readonly at: Date;
  readonly data: Buffer;
  readonly mimeType: string;
}

export interface SpeechEndEvent {
  readonly at: Date;
  readonly result?: ASRResult;
  readonly snapshot: PerceptionSnapshot;
}

export interface PerceptionEventMap {
  speechend(event: SpeechEndEvent): void;
  error(error: Error): void;
}

export interface Perception {
  readonly asr: ASR;
  readonly image?: ImageStream;

  on<K extends keyof PerceptionEventMap>(event: K, callback: PerceptionEventMap[K]): Unsubscribe;

  snapshot(options?: SnapshotOptions): Promise<PerceptionSnapshot>;
  close(): Promise<void>;
}
