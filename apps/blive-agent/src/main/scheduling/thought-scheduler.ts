import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core';
import type { WakeEvent } from 'cieljs/hearing';
import type { Perception } from 'cieljs/perception';

import type { WatchWakeOptions } from './wake.ts';

export interface ThoughtSchedulerOptions {
  perception: Pick<Perception, 'snapshot'>;
  agent: Pick<Agent, 'prompt'> & Partial<Pick<Agent, 'abort'>>;
  minimumIntervalMs: number;
  /** 单轮思考的时间预算；省略表示不限制。 */
  thinkTimeoutMs?: number;
  startedAt: Date;
  context: (wake?: WakeEvent) => AgentMessage;
  beforeRun?: () => void;
  afterRun?: () => Promise<void> | void;
  onRunStarted?: (triggerCount: number) => void;
  onRunFinished?: (durationMs: number) => void;
  onError?: (error: Error) => void;
}

interface PendingWindow {
  startAt: Date;
  endAt: Date;
  triggerCount: number;
  wake?: WakeEvent;
}

export class ThoughtScheduler {
  private capturedThrough: number;
  private lastRunAt = Number.NEGATIVE_INFINITY;
  private pending?: PendingWindow;
  private active?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private finishing = false;
  private wakeWindow?: { signal: WakeEvent; minAt: number; maxAt: number; speechEnded: boolean };

  constructor(private readonly options: ThoughtSchedulerOptions) {
    this.capturedThrough = options.startedAt.getTime() - 1;
  }

  trigger(at = new Date(), reason: 'observation' | 'speechend' = 'observation'): void {
    if (this.closed) {
      return;
    }

    if (this.wakeWindow && reason === 'speechend' && at >= this.wakeWindow.signal.at) {
      this.wakeWindow.speechEnded = true;
      this.clearTimer();
    }

    // 迟到或同一毫秒的触发不能倒退已消费的快照边界。
    if (at.getTime() <= this.capturedThrough) {
      this.schedule();

      return;
    }

    const startAt = this.pending?.startAt ?? new Date(this.capturedThrough + 1);
    const triggerCount = (this.pending?.triggerCount ?? 0) + 1;

    this.capturedThrough = Math.max(this.capturedThrough, at.getTime());
    this.pending = { startAt, endAt: at, triggerCount };

    this.schedule();
  }

  /** 唤醒时间来自音频，等待期限使用接收时钟；迟到的 KWS 事件也不能被普通快照水位丢弃。 */
  wake(
    event: WakeEvent,
    options: Required<Pick<WatchWakeOptions, 'minWaitMs' | 'maxWaitMs'>>,
  ): boolean {
    if (this.closed || this.finishing || this.wakeWindow) {
      return false;
    }

    const now = Date.now();

    this.wakeWindow = {
      signal: event,
      minAt: now + options.minWaitMs,
      maxAt: now + options.maxWaitMs,
      speechEnded: false,
    };

    this.pending ??= {
      startAt: new Date(this.capturedThrough + 1),
      endAt: new Date(Math.max(now, this.capturedThrough + 1)),
      triggerCount: 0,
    };

    this.pending.triggerCount += 1;
    this.clearTimer();
    this.schedule();

    return true;
  }

  cancel(): void {
    this.closed = true;
    this.pending = undefined;
    this.wakeWindow = undefined;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  async close(): Promise<void> {
    this.cancel();
    await this.active;
  }

  /** 录播结束后把尚未消费的感知附在总结请求前，避免关闭时丢掉尾段。 */
  async finish(summary: string, mediaEndAt?: Date, signal?: AbortSignal): Promise<void> {
    this.finishing = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    await this.active;
    const startAt = this.pending?.startAt ?? new Date(this.capturedThrough + 1);
    await this.close();
    const endAt = new Date(Math.max(mediaEndAt?.getTime() ?? Date.now(), startAt.getTime()));
    const snapshot = await this.options.perception.snapshot({ startAt, endAt });
    const messages = await snapshot.compose();

    if (signal?.aborted) {
      return;
    }

    await this.options.agent.prompt([
      ...messages,
      this.options.context(),
      { role: 'user', content: summary, timestamp: Date.now() },
    ]);
  }

  private schedule(): void {
    if (this.closed || this.finishing || this.active || this.timer || !this.pending) {
      return;
    }

    const wake = this.wakeWindow;
    let dueAt = this.lastRunAt + this.options.minimumIntervalMs;

    if (wake) {
      dueAt = wake.speechEnded ? wake.minAt : wake.maxAt;
    }

    const delay = Math.max(0, dueAt - Date.now());

    if (delay === 0) {
      this.startRun();

      return;
    }

    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.startRun();
    }, delay);
  }

  private startRun(): void {
    const window = this.pending;

    if (!window || this.closed) {
      return;
    }

    this.pending = undefined;

    if (this.wakeWindow) {
      window.wake = this.wakeWindow.signal;

      // 等待后再截取尾段，不能把快照停留在关键词起点。
      window.endAt = new Date(
        Math.max(Date.now(), window.endAt.getTime(), window.startAt.getTime()),
      );

      this.capturedThrough = Math.max(this.capturedThrough, window.endAt.getTime());
      this.wakeWindow = undefined;
    }

    this.lastRunAt = Date.now();
    this.options.beforeRun?.();
    this.options.onRunStarted?.(window.triggerCount);

    this.active = this.run(window).finally(() => {
      this.active = undefined;
      this.schedule();
    });
  }

  // oxlint-disable-next-line eslint/complexity -- 调度状态机在一个临界区内处理过期、取消和重排。
  private async run(window: PendingWindow): Promise<void> {
    const startedAt = Date.now();
    const timeoutMs = this.options.thinkTimeoutMs;
    let timedOut = false;

    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          this.options.agent.abort?.();
        }, timeoutMs)
      : undefined;

    try {
      const snapshot = await this.options.perception.snapshot({
        startAt: window.startAt,
        endAt: window.endAt,
      });

      const messages = await snapshot.compose();

      if (this.closed) {
        return;
      }

      await this.options.agent.prompt([...messages, this.options.context(window.wake)]);

      if (timedOut && !this.closed) {
        this.options.onError?.(timeoutError(timeoutMs!));

        return;
      }

      await this.options.afterRun?.();
      this.options.onRunFinished?.(Date.now() - startedAt);
    } catch (error) {
      const failure = toError(error);

      const aborted =
        failure.name === 'AbortError' || /Request (?:was )?aborted/iu.test(failure.message);

      if (this.closed && aborted) {
        return;
      }

      if (timedOut) {
        this.options.onError?.(timeoutError(timeoutMs!, failure));

        return;
      }

      if (failure.message.includes('content_filter')) {
        this.cancel();
      }

      this.options.onError?.(failure);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  private clearTimer(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}

function timeoutError(timeoutMs: number, cause?: Error) {
  return new Error(`单轮思考超过 ${timeoutMs} ms，已中止本轮`, { cause });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
