// @env node

import { randomUUID } from 'node:crypto';

import type { ASRResult } from '@cieljs/hearing';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type {
  HearingPerceptionContext,
  PerceptionContext,
  PerceptionFrame,
  PerceptionSnapshot,
  VisionPerceptionContext,
} from './types.ts';
import { composeVisionFrames } from './vision/composer.ts';

interface SnapshotData {
  readonly startAt: Date;
  readonly endAt: Date;
  readonly transcripts: readonly ASRResult[];
  readonly frames: readonly PerceptionFrame[];
  readonly context?: PerceptionContext;
  readonly maxFrames: number;
}

type SnapshotContextInput =
  | Omit<VisionPerceptionContext, 'snapshotId' | 'startAt' | 'endAt'>
  | Omit<HearingPerceptionContext, 'snapshotId' | 'startAt' | 'endAt'>;

export function createPerceptionSnapshot(data: SnapshotData): PerceptionSnapshot {
  return new FrozenPerceptionSnapshot(data);
}

class FrozenPerceptionSnapshot implements PerceptionSnapshot {
  readonly id = randomUUID();
  readonly startAt: Date;
  readonly endAt: Date;
  readonly transcripts: readonly ASRResult[];
  readonly frames: readonly PerceptionFrame[];

  private readonly context?: PerceptionContext;
  private readonly maxFrames: number;

  constructor(data: SnapshotData) {
    this.startAt = new Date(data.startAt);
    this.endAt = new Date(data.endAt);
    this.transcripts = Object.freeze(data.transcripts.map(cloneTranscript));
    this.frames = Object.freeze(data.frames.map(cloneFrame));
    this.context = data.context;
    this.maxFrames = data.maxFrames;
  }

  async compose(): Promise<AgentMessage[]> {
    const content: Array<
      { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
    > = [];

    const images = await this.composeImages();

    if (images.length > 0) {
      const context = await this.resolveContext({
        modality: 'vision',
        frames: this.frames,
        sources: [...groupFrames(this.frames).keys()],
      });

      content.push({
        type: 'text',
        text: ['# 视觉', context].filter(Boolean).join('\n\n'),
      });

      content.push(...images);
    }

    if (this.transcripts.length > 0) {
      const transcript = this.transcripts.map(formatTranscript).join('\n');

      const context = await this.resolveContext({
        modality: 'hearing',
        transcripts: this.transcripts,
      });

      content.push({
        type: 'text',
        text: ['# 听觉', context, transcript].filter(Boolean).join('\n\n'),
      });
    }

    if (content.length === 0) {
      return [];
    }

    return [
      {
        role: 'user',
        content,
        timestamp: this.endAt.getTime(),
      },
    ];
  }

  private resolveContext(input: SnapshotContextInput) {
    return this.context?.({
      ...input,
      snapshotId: this.id,
      startAt: this.startAt,
      endAt: this.endAt,
    });
  }

  private async composeImages() {
    const groups = groupFrames(this.frames);
    const images = [];

    for (const frames of groups.values()) {
      const selected = selectFrames(frames, this.maxFrames);
      const data = await composeVisionFrames(selected.map(frame => frame.data));

      images.push({
        type: 'image' as const,
        data: data.toString('base64'),
        mimeType: 'image/jpeg',
      });
    }

    return images;
  }
}

function groupFrames(frames: readonly PerceptionFrame[]) {
  const groups = new Map<string, PerceptionFrame[]>();

  for (const frame of frames) {
    const group = groups.get(frame.source) ?? [];

    group.push(frame);
    groups.set(frame.source, group);
  }

  return groups;
}

function selectFrames(frames: readonly PerceptionFrame[], limit: number) {
  if (frames.length <= limit) {
    return frames;
  }

  if (limit === 1) {
    return [frames.at(-1)!];
  }

  return Array.from({ length: limit }, (_, index) => {
    const position = Math.round((index * (frames.length - 1)) / (limit - 1));

    return frames[position]!;
  });
}

function formatTranscript(transcript: ASRResult) {
  const events = transcript.events?.map(event => event.type).join('|');
  const fields = [`时间: ${transcript.startAt.toISOString()}`];

  if (transcript.speaker) {
    fields.push(`说话人: [${transcript.speaker}]`);
  }

  if (events) {
    fields.push(`声音事件: ${events}`);
  }

  return `${fields.join(', ')}\n${transcript.content}`;
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

function cloneFrame(frame: PerceptionFrame): PerceptionFrame {
  return {
    ...frame,
    at: new Date(frame.at),
    data: Buffer.from(frame.data),
  };
}
