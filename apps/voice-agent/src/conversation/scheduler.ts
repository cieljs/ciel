import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core';
import type { Perception, PerceptionSnapshot } from 'cieljs/perception';

import type { DeviceSelector } from '../audio/types.ts';
import type { SpeakController, ThinkRunGate } from './speak-tool.ts';

export type VoiceAgentEvent =
  | { type: 'speech_end'; at: Date; speaker?: string; content?: string }
  | { type: 'pending_created'; window: PendingWindow }
  | { type: 'pending_merged'; window: PendingWindow }
  | { type: 'think_started'; window: PendingWindow }
  | { type: 'think_finished'; spoke: boolean; durationMs: number }
  | { type: 'tts_started'; text: string; characterCount: number }
  | { type: 'tts_finished'; durationMs: number }
  | { type: 'playback_started'; device?: DeviceSelector }
  | { type: 'playback_finished'; durationMs: number }
  | { type: 'tool_call_started'; name: string; args?: unknown }
  | { type: 'tool_call_finished'; name: string; isError: boolean }
  | { type: 'self_echo_ignored'; at: Date }
  | { type: 'error'; stage: string; error: Error };

export interface PendingWindow {
  startInclusive: Date;
  endInclusive: Date;
  speechEndCount: number;
  snapshots: Promise<PerceptionSnapshot>[];
}

export type SchedulerState =
  | { status: 'idle' }
  | { status: 'waiting'; pending: PendingWindow; eligibleAt: Date }
  | { status: 'thinking'; run: ThinkRun; pending?: PendingWindow }
  | { status: 'closed' };

interface ThinkRun {
  window: PendingWindow;
  gate: ThinkRunGate;
  startedAt: Date;
}

export interface ConversationSchedulerOptions {
  perception: Pick<Perception, 'snapshot'>;
  agent: Pick<Agent, 'prompt'>;
  speak: SpeakController;
  minimumThinkIntervalMs: number;
  startedAt: Date;
  emit: (event: VoiceAgentEvent) => void;
}

const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;

export class ConversationScheduler {
  private capturedThrough: number;
  private processedThrough: number;
  private lastThinkStartedAt = Number.NEGATIVE_INFINITY;
  private retryDelayMs = INITIAL_RETRY_DELAY_MS;
  private thinkTimer: ReturnType<typeof setTimeout> | undefined;
  private activeRun: Promise<void> | undefined;
  private stateValue: SchedulerState = { status: 'idle' };
  private closed = false;

  constructor(private readonly options: ConversationSchedulerOptions) {
    this.capturedThrough = options.startedAt.getTime() - 1;
    this.processedThrough = options.startedAt.getTime() - 1;
  }

  get state(): SchedulerState {
    return this.stateValue;
  }

  get capturedThroughTime(): Date {
    return new Date(this.capturedThrough);
  }

  get processedThroughTime(): Date {
    return new Date(this.processedThrough);
  }

  handleSpeechEnd(at: Date): void {
    if (this.closed) {
      return;
    }

    this.options.speak.noteSpeech();

    const startAt = new Date(this.capturedThrough + 1);
    const snapshot = this.options.perception.snapshot({ startAt, endAt: at });

    this.capturedThrough = at.getTime();

    this.mergeSpeechEnd(startAt, at, snapshot);
  }

  skipThrough(at: Date): void {
    if (this.closed) {
      return;
    }

    this.capturedThrough = at.getTime();
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.clearThinkTimer();
    this.stateValue = { status: 'closed' };

    await this.activeRun;
  }

  private mergeSpeechEnd(startAt: Date, at: Date, snapshot: Promise<PerceptionSnapshot>): void {
    if (this.stateValue.status === 'idle') {
      const window = this.createWindow(startAt, at, snapshot);

      if (this.isEligibleNow()) {
        this.startThink(window);
      } else {
        this.options.emit({ type: 'pending_created', window });
        this.enterWaiting(window, this.nextEligibleAt());
      }

      return;
    }

    if (this.stateValue.status === 'waiting') {
      this.stateValue.pending = this.extendWindow(this.stateValue.pending, at, snapshot);
      this.options.emit({ type: 'pending_merged', window: this.stateValue.pending });

      return;
    }

    if (this.stateValue.status === 'thinking') {
      if (this.stateValue.pending) {
        this.stateValue.pending = this.extendWindow(this.stateValue.pending, at, snapshot);
        this.options.emit({ type: 'pending_merged', window: this.stateValue.pending });
      } else {
        const window = this.createWindow(startAt, at, snapshot);

        this.stateValue.pending = window;
        this.options.emit({ type: 'pending_created', window });
      }
    }
  }

  private createWindow(
    startAt: Date,
    at: Date,
    snapshot: Promise<PerceptionSnapshot>,
  ): PendingWindow {
    return {
      startInclusive: startAt,
      endInclusive: at,
      speechEndCount: 1,
      snapshots: [snapshot],
    };
  }

  private extendWindow(
    window: PendingWindow,
    at: Date,
    snapshot: Promise<PerceptionSnapshot>,
  ): PendingWindow {
    return {
      startInclusive: window.startInclusive,
      endInclusive: at,
      speechEndCount: window.speechEndCount + 1,
      snapshots: [...window.snapshots, snapshot],
    };
  }

  private startThink(window: PendingWindow): void {
    const gate = this.options.speak.beginRun();
    const run: ThinkRun = { window, gate, startedAt: new Date() };

    this.lastThinkStartedAt = run.startedAt.getTime();
    this.stateValue = { status: 'thinking', run };

    this.options.emit({ type: 'think_started', window });

    this.activeRun = this.runThink(run);
  }

  private async runThink(run: ThinkRun): Promise<void> {
    const startedAt = run.startedAt.getTime();

    try {
      const messages = await this.composeWindow(run.window);

      if (messages.length > 0) {
        await this.options.agent.prompt(messages);
      }

      this.processedThrough = run.window.endInclusive.getTime();
      this.retryDelayMs = INITIAL_RETRY_DELAY_MS;

      const { delivered } = this.options.speak.endRun();

      this.options.emit({
        type: 'think_finished',
        spoke: delivered,
        durationMs: Date.now() - startedAt,
      });

      this.afterThinkComplete();
    } catch (error) {
      this.options.speak.endRun();
      this.options.emit({ type: 'error', stage: 'agent', error: toError(error) });
      this.requeueAndRetry(run);
    }
  }

  private async composeWindow(window: PendingWindow): Promise<AgentMessage[]> {
    const snapshots = await Promise.all(window.snapshots);
    const messages: AgentMessage[] = [];

    for (const snapshot of snapshots) {
      messages.push(...(await snapshot.compose()));
    }

    return messages;
  }

  private requeueAndRetry(run: ThinkRun): void {
    const backoffMs = this.retryDelayMs;

    this.retryDelayMs = Math.min(this.retryDelayMs * 2, MAX_RETRY_DELAY_MS);

    const existing = this.stateValue.status === 'thinking' ? this.stateValue.pending : undefined;

    const merged: PendingWindow = existing
      ? {
          startInclusive: run.window.startInclusive,
          endInclusive: existing.endInclusive,
          speechEndCount: run.window.speechEndCount + existing.speechEndCount,
          snapshots: [...run.window.snapshots, ...existing.snapshots],
        }
      : run.window;

    this.options.emit({ type: 'pending_created', window: merged });
    this.enterWaiting(merged, new Date(Date.now() + backoffMs));
  }

  private afterThinkComplete(): void {
    if (this.closed) {
      return;
    }

    const pending = this.stateValue.status === 'thinking' ? this.stateValue.pending : undefined;

    if (!pending) {
      this.stateValue = { status: 'idle' };

      return;
    }

    if (this.isEligibleNow()) {
      this.startThink(pending);
    } else {
      this.enterWaiting(pending, this.nextEligibleAt());
    }
  }

  private enterWaiting(window: PendingWindow, eligibleAt: Date): void {
    this.stateValue = { status: 'waiting', pending: window, eligibleAt };
    this.scheduleThinkTimer(eligibleAt);
  }

  private scheduleThinkTimer(eligibleAt: Date): void {
    this.clearThinkTimer();

    const delay = Math.max(0, eligibleAt.getTime() - Date.now());

    this.thinkTimer = setTimeout(() => {
      this.thinkTimer = undefined;
      this.onThinkEligible();
    }, delay);
  }

  private onThinkEligible(): void {
    if (this.closed || this.stateValue.status !== 'waiting') {
      return;
    }

    const pending = this.stateValue.pending;

    this.startThink(pending);
  }

  private clearThinkTimer(): void {
    if (this.thinkTimer) {
      clearTimeout(this.thinkTimer);
      this.thinkTimer = undefined;
    }
  }

  private isEligibleNow(): boolean {
    return Date.now() >= this.nextEligibleAt().getTime();
  }

  private nextEligibleAt(): Date {
    return new Date(this.lastThinkStartedAt + this.options.minimumThinkIntervalMs);
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
