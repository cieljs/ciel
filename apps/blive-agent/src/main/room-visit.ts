import type { CielSession } from 'cieljs';
import type { ASRModelId, KWS, WakeEvent } from 'cieljs/hearing';
import type { Perception } from 'cieljs/perception';
import type { TraceHost } from 'cieljs/trace/host';

import type { RoomInfo, WatchEvent, WatchMode } from '../shared/types.ts';
import type { LiveMedia } from './media/live-media.ts';
import { createRoomContext, type SentDanmaku } from './prompts/index.ts';
import { ThoughtScheduler } from './scheduling/thought-scheduler.ts';
import { createWakeContext, type WatchWakeOptions } from './scheduling/wake.ts';

interface RoomVisitOptions {
  trace?: TraceHost;
  generation: number;
  room: RoomInfo;
  mode: WatchMode;
  startedAt: number;
  session: CielSession;
  perception: Perception;
  media: LiveMedia;
  wake?: {
    kws: KWS;
    options: Required<WatchWakeOptions>;
  };
  minimumThinkIntervalMs: number;
  periodicObservationMs: number;
  thinkTimeoutMs?: number;
  canSwitch: () => boolean;
  afterRun: () => Promise<void> | void;
  emit: (event: WatchEvent) => void;
}

/** 一次访问拥有感知、媒体与思考任务；持久化身份由房间和日期另行决定。 */
export class RoomVisit {
  readonly history: SentDanmaku[] = [];
  private readonly scheduler: ThoughtScheduler;
  private unsubscribeSpeechEnd?: () => void;
  private periodicTimer?: ReturnType<typeof setInterval>;
  private closePromise?: Promise<void>;
  private unsubscribeAgent?: () => void;
  private unsubscribePerceptionError?: () => void;
  private unsubscribeTranscript?: () => void;
  private unsubscribeWake?: () => void;
  private unsubscribeWakeError?: () => void;
  private lastWakeAt = -Infinity;
  private cancelled = false;

  constructor(private readonly options: RoomVisitOptions) {
    this.scheduler = new ThoughtScheduler({
      perception: options.perception,
      agent: options.session.agent,
      minimumIntervalMs: options.minimumThinkIntervalMs,
      thinkTimeoutMs: options.thinkTimeoutMs,
      startedAt: new Date(options.startedAt),
      context: wake => ({
        role: 'user',
        content:
          createRoomContext({
            room: options.room,
            mode: options.mode,
            startedAt: options.startedAt,
            history: this.history,
            canSwitch: options.canSwitch(),
          }) + (wake ? createWakeContext(wake) : ''),
        timestamp: Date.now(),
      }),
      afterRun: options.afterRun,
      onRunStarted: triggerCount => options.emit({ type: 'thought_started', triggerCount }),
      onRunFinished: durationMs => options.emit({ type: 'thought_finished', durationMs }),
      onError: error => options.emit({ type: 'error', stage: 'thought', error }),
    });
  }

  get generation() {
    return this.options.generation;
  }
  get room() {
    return this.options.room;
  }
  get startedAt() {
    return this.options.startedAt;
  }
  get session() {
    return this.options.session;
  }

  start() {
    this.unsubscribeAgent = this.options.trace?.observe(this.session.agent, this.session.id);

    this.unsubscribePerceptionError = this.options.perception.on('error', error =>
      this.options.emit({ type: 'error', stage: 'perception', error }),
    );

    this.unsubscribeTranscript = this.options.perception.asr.on('result', result => {
      const content = result.content.trim();

      if (content) {
        this.options.emit({ type: 'asr_subtitle', content });
      }

      if (this.options.mode.type !== 'recording') {
        return;
      }

      const events = result.events?.map(event => event.type).join('、');

      const details = [content, result.speaker, events ? `声音事件（模型识别）：${events}` : '']
        .filter(Boolean)
        .join('\n');

      if (!details) {
        return;
      }

      const seconds = Math.max(0, (result.startAt.getTime() - this.startedAt) / 1_000);

      const timestamp = `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
        .toString()
        .padStart(2, '0')}`;

      this.options.trace?.recordMessage(`视频语音 · ${timestamp}`, details, this.session.id);
    });

    if (this.options.mode.type === 'recording') {
      this.options.media.start();

      return;
    }

    if (this.options.wake) {
      this.unsubscribeWake = this.options.wake.kws.on('wake', event => this.handleWake(event));

      this.unsubscribeWakeError = this.options.wake.kws.on('error', error =>
        this.options.emit({ type: 'error', stage: 'wake', error }),
      );
    }

    this.unsubscribeSpeechEnd = this.options.perception.on('speechend', ({ at }) =>
      this.scheduler.trigger(at, 'speechend'),
    );

    this.periodicTimer = setInterval(
      () => this.scheduler.trigger(new Date()),
      this.options.periodicObservationMs,
    );

    this.options.media.start();
  }

  /** 唤醒只把这一轮提前并带上唤醒上下文，宿主不替 Ciel 发言；冷却内的重复命中直接合并。 */
  private handleWake(event: WakeEvent): void {
    const wake = this.options.wake;

    if (!wake || this.cancelled || Date.now() - this.lastWakeAt < wake.options.cooldownMs) {
      return;
    }

    if (!this.scheduler.wake(event, wake.options)) {
      return;
    }

    this.lastWakeAt = Date.now();
    this.options.trace?.recordMessage('关键词唤醒', createWakeContext(event), this.session.id);
  }

  cancel(): void {
    this.cancelled = true;
    this.unsubscribeWake?.();
    this.scheduler.cancel();
    this.session.agent.abort();
  }

  setHearingModel(model: ASRModelId): Promise<void> {
    return this.options.perception.asr.setModel(model);
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeResources();

    return this.closePromise;
  }

  async finishRecording(signal?: AbortSignal, partial = false): Promise<void> {
    clearInterval(this.periodicTimer);
    this.unsubscribeSpeechEnd?.();
    await this.options.media.close();
    this.options.emit({ type: 'video_progress', stage: 'recognizing' });
    // close 会 flush ASR 并等待尾部识别发布；快照在关闭后仍可读取。
    await this.options.perception.close();

    if (this.closePromise || signal?.aborted) {
      return;
    }

    this.options.emit({ type: 'video_progress', stage: 'analyzing' });

    const summary = partial
      ? '用户中途停止了视频，视频尚未完整看完。请只总结本次已经读取的画面和语音，明确标注这是一份部分总结，不推测后续内容，不声称看完全部视频。覆盖已观察到的主题、关键内容、分析结论、值得记住的信息与仍不确定之处；继续遵守视频模式的记忆规则。'
      : '录播已经播放结束。请基于本次 Session 中的全部亲历内容给出最终总结：覆盖主题、关键内容、分析结论、值得记住的信息与仍不确定之处；继续遵守录播模式的记忆规则。';

    await this.scheduler.finish(summary, this.options.media.endAt, signal);
  }

  private async closeResources() {
    this.cancelled = true;
    this.unsubscribeWake?.();
    clearInterval(this.periodicTimer);
    this.unsubscribeSpeechEnd?.();

    // 先停止触发并等当前思考结束，再关闭可能产生最后一次 speechend 的感知资源。
    await this.scheduler.close();
    this.unsubscribeAgent?.();
    this.unsubscribePerceptionError?.();
    const media = await Promise.allSettled([this.options.media.close()]);

    const remaining = await Promise.allSettled([
      this.options.wake?.kws.close(),
      this.options.perception.close(),
      this.options.session.close(),
    ]);

    const failures = [...media, ...remaining]
      .filter(result => result.status === 'rejected')
      .map(result => result.reason);

    this.unsubscribeTranscript?.();
    this.unsubscribeWakeError?.();

    if (failures.length) {
      throw new AggregateError(failures, `直播间 ${this.room.roomId} 关闭失败`);
    }
  }
}
