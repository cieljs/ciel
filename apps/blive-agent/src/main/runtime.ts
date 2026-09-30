import { join } from 'node:path';

import type { AgentTool, ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { Ciel, CielSession } from 'cieljs';
import type { CielData } from 'cieljs';
import { createKWS, type ASRModelId, type ASROptions, type KWS } from 'cieljs/hearing';
import type { McpTools } from 'cieljs/mcp';
import { createPerception, type PerceptionOptions } from 'cieljs/perception';
import type { Storage } from 'cieljs/storage';
import type { TraceHost } from 'cieljs/trace/host';

import type {
  Account,
  RoomInfo,
  StartWatchOptions,
  WatchEvent,
  WatchStatus,
} from '../shared/types.ts';
import { createWatchCiel } from './agent/ciel.ts';
import { readRoomDecision } from './agent/decisions.ts';
import { selectExplorationRoom } from './agent/exploration.ts';
import { createRoomSessionOptions } from './agent/room-session.ts';
import { createStreamerTools } from './agent/streamer-tools.ts';
import { createDanmakuTool, DanmakuRunGate } from './agent/tools.ts';
import { BilibiliApi } from './bilibili/api.ts';
import type { LivePage } from './bilibili/live-page.ts';
import { LiveStatusMonitor } from './bilibili/live-status-monitor.ts';
import { readRoomLiveStatus } from './bilibili/live-status.ts';
import { LiveMedia } from './media/live-media.ts';
import { createPerceptionContext, ROOM_REVIEW_AFTER_MS } from './prompts/index.ts';
import { RoomHistory } from './room-history.ts';
import { RoomScorePolicy } from './room-score-policy.ts';
import { RoomVisit } from './room-visit.ts';
import { resolveWakeOptions, type WatchWakeOptions } from './scheduling/wake.ts';
import { loadVoiceprints } from './voiceprints.ts';

export type { WatchWakeOptions } from './scheduling/wake.ts';

export interface BliveAgentOptions {
  mcp?: McpTools;
  biliTools?: AgentTool[];
  storage: Storage;
  data: CielData;
  trace?: TraceHost;
  model: Model<Api>;
  apiKey?: string;
  livePage: LivePage;
  dataDir: string;
  api?: BilibiliApi;
  ffmpegPath?: string;
  perception?: Omit<PerceptionOptions, 'asr'> & {
    asr?: Omit<ASROptions, 'modelsPath'>;
  };
  periodicObservationMs?: number;
  minimumThinkIntervalMs?: number;
  /** 单轮思考的时间预算；省略表示不限制。 */
  thinkTimeoutMs?: number;
  /** 推理强度；省略时沿用模型默认。 */
  thinkingLevel?: ThinkingLevel;
  wake?: WatchWakeOptions;
}

export interface BliveAgent {
  readonly status: WatchStatus;
  readonly room?: RoomInfo;
  readonly sessionId?: string;

  start(options: StartWatchOptions): Promise<void>;
  stop(): Promise<void>;
  /** 手动压缩当前会话上下文；返回是否产生了新的压缩摘要。 */
  compactContext(): Promise<boolean>;
  setHearingModel(model: ASRModelId): Promise<void>;
  login(): Promise<Account>;
  logout(): Promise<void>;
  areas(): ReturnType<BilibiliApi['areas']>;
  close(): Promise<void>;
  onEvent(listener: (event: WatchEvent) => void): () => void;
}

export function createBliveAgent(options: BliveAgentOptions): BliveAgent {
  return new BliveAgentRuntime(options);
}

class BliveAgentRuntime implements BliveAgent {
  private currentStatus: WatchStatus = 'idle';
  private startOptions?: Required<Pick<StartWatchOptions, 'danmakuDelivery'>> & StartWatchOptions;
  private closePromise?: Promise<void>;
  private videoStop?: Promise<void>;
  private operation: Promise<void> = Promise.resolve();
  private runController?: AbortController;
  private loginController?: AbortController;
  private ciel?: Ciel;
  private visit?: RoomVisit;
  private liveStatusMonitor?: LiveStatusMonitor;
  private accountValue?: Account;
  private visitGeneration = 0;
  private readonly listeners = new Set<(event: WatchEvent) => void>();
  private readonly api: BilibiliApi;
  private readonly danmakuGate = new DanmakuRunGate();
  private readonly scorePolicy = new RoomScorePolicy();
  private readonly roomHistory = new RoomHistory();

  constructor(private readonly options: BliveAgentOptions) {
    if (options.wake) {
      resolveWakeOptions(options.wake);
    }

    this.api = options.api ?? new BilibiliApi();
  }

  get status(): WatchStatus {
    return this.currentStatus;
  }

  setHearingModel(model: ASRModelId): Promise<void> {
    return this.enqueue(async () => {
      await this.visit?.setHearingModel(model);

      this.options.perception = {
        ...this.options.perception,
        asr: { ...this.options.perception?.asr, model },
      };
    });
  }

  get room(): RoomInfo | undefined {
    return this.visit?.room;
  }

  get sessionId(): string | undefined {
    return this.visit?.session.id;
  }

  onEvent(listener: (event: WatchEvent) => void): () => void {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  }

  areas(): ReturnType<BilibiliApi['areas']> {
    return this.api.areas();
  }

  async compactContext(): Promise<boolean> {
    if (this.closePromise) {
      throw new Error('Blive Agent 已关闭');
    }

    const visit = this.visit;

    if (!visit) {
      throw new Error('当前没有正在观看的直播间');
    }

    return visit.session.compact();
  }

  async login(): Promise<Account> {
    if (this.closePromise) {
      throw new Error('Blive Agent 已关闭');
    }

    await this.stop();
    const controller = new AbortController();
    this.loginController = controller;

    try {
      await this.options.livePage.login();
      controller.signal.throwIfAborted();
      this.setStatus('awaiting-login');

      const account = await this.options.livePage.waitForLogin(controller.signal);
      controller.signal.throwIfAborted();
      this.accountValue = account;

      return account;
    } finally {
      // 超时和取消也必须离开 awaiting-login；关闭后的状态不能被迟到结果覆盖。
      if (this.loginController === controller) {
        this.loginController = undefined;

        if (this.currentStatus === 'awaiting-login') {
          this.setStatus('idle');
        }
      }
    }
  }

  async logout(): Promise<void> {
    await this.stop();
    this.accountValue = undefined;
    await this.options.livePage.logout();
  }

  start(options: StartWatchOptions): Promise<void> {
    if (this.closePromise) {
      throw new Error('Blive Agent 已关闭');
    }

    validateStartOptions(options);
    this.loginController?.abort();
    this.runController?.abort();
    this.visit?.cancel();

    const controller = new AbortController();
    this.runController = controller;

    return this.enqueue(async () => {
      await this.stopRuntime();
      controller.signal.throwIfAborted();
      await this.startRuntime(options, controller.signal);
    });
  }

  private async startRuntime(options: StartWatchOptions, signal: AbortSignal): Promise<void> {
    this.startOptions = {
      ...options,
      danmakuDelivery: options.danmakuDelivery ?? 'simulate',
    };

    this.setStatus('starting');

    try {
      if (options.mode.type !== 'recording') {
        this.accountValue = await this.options.livePage.account();
      }

      if (
        options.mode.type !== 'recording' &&
        this.startOptions.danmakuDelivery === 'live' &&
        !this.accountValue
      ) {
        this.setStatus('awaiting-login');
        throw new Error('真实弹幕模式需要先登录 Bilibili');
      }

      signal.throwIfAborted();
      this.ciel = this.createCiel();
      await this.ciel.start();
      signal.throwIfAborted();

      if (options.mode.type === 'follow') {
        const room = await this.api.room(options.mode.roomId);
        await this.openRoom(room, signal);
      } else if (options.mode.type === 'explore') {
        await this.explore(options.mode.areaId, signal);
      } else {
        const room = await this.api.room(options.mode.roomId);
        await this.openRecording(room, options.mode, signal);
      }
    } catch (error) {
      await this.disposeRuntime();
      this.setStatus('idle');
      this.emitError('start', error);
      throw error;
    }
  }

  stop(): Promise<void> {
    if (this.videoStop) {
      return this.videoStop;
    }

    const visit = this.visit;

    if (
      visit &&
      this.startOptions?.mode.type === 'recording' &&
      this.currentStatus === 'watching'
    ) {
      const signal = this.runController?.signal;
      this.setStatus('stopping');

      // 用户停止视频保留已读取内容；先完成部分总结，再释放 Session。
      this.videoStop = this.enqueue(async () => {
        try {
          if (this.visit === visit) {
            await visit.finishRecording(signal, true);
          }
        } finally {
          await this.stopRuntime();
        }
      }).finally(() => {
        this.videoStop = undefined;
      });

      return this.videoStop;
    }

    this.loginController?.abort();
    this.runController?.abort();
    this.visit?.cancel();

    return this.enqueue(() => this.stopRuntime());
  }

  // 启动、切房和停止共用一条队列，资源关闭后才允许下一次打开。
  private enqueue(action: () => Promise<void>): Promise<void> {
    const operation = this.operation.then(action);

    this.operation = operation.then(
      () => undefined,
      () => undefined,
    );

    return operation;
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeRuntime();

    return this.closePromise;
  }

  private createCiel(): Ciel {
    const mode = this.requireStartOptions().mode;
    let danmakuTool;

    if (mode.type !== 'recording') {
      danmakuTool = createDanmakuTool(
        {
          delivery: () => this.requireStartOptions().danmakuDelivery,
          livePage: this.options.livePage,
          room: () => this.visit?.room,
          sentDanmaku: () => this.visit?.history.map(item => item.content) ?? [],
          canSend: () => this.currentStatus === 'watching' && !this.runController?.signal.aborted,
          emit: event => this.recordDanmakuEvent(event),
        },
        this.danmakuGate,
      );
    }

    return createWatchCiel({
      data: this.options.data,
      model: this.options.model,
      apiKey: this.options.apiKey,
      mode,
      mcp: this.options.mcp,
      biliTools: this.options.biliTools,
      danmakuTool,
      streamerTools: createStreamerTools({
        api: this.api,
        room: () => this.visit?.room,
        readInPage: url => this.options.livePage.readPublicApi(url),
      }),
    });
  }

  /**
   * 选房失败不影响当前观看：选到房间后才由 openRoom 关闭当前访问，
   * 失败时原样抛出，房间、会话和媒体都保持原状，等冷却结束再决定是否切房。
   */
  private async explore(areaId: number, signal: AbortSignal, from?: RoomVisit): Promise<void> {
    signal.throwIfAborted();

    // 触发选房后已经离开该房间（下播、手动停止或另一次切换），放弃这次结果。
    if (from && this.visit !== from) {
      return;
    }

    const ciel = this.requireCiel();

    // 已有房间时保持 watching：选房期间原房间继续观看，权限和评分规则都不中断。
    if (!this.visit) {
      this.setStatus('exploring');
    }

    this.emit({ type: 'exploration_started', areaId });

    const room = await selectExplorationRoom({
      areaId,
      signal,
      ciel,
      api: this.api,
      // 只有评分判定切房时才有 from；下播路径的房间已经在 closeVisit 时进了冷却，不必再描述一遍。
      previous: from
        ? {
            room: from.room,
            watchedSeconds: Math.floor((Date.now() - from.startedAt) / 1_000),
            reason: '宿主评分判定继续观看价值不足',
          }
        : undefined,
      cooling: this.roomHistory.cooling(),
      trace: this.options.trace,
      emit: event => this.emit(event),
    });

    try {
      await this.openRoom(room, signal);
    } catch (error) {
      // 已开播但页面没起来也算「刚试过这个房间」，下一轮探索不该立刻又把它捞回来。
      this.roomHistory.record(room);
      throw error;
    }
  }

  private createPerception(retentionMs = this.options.perception?.retentionMs ?? 60_000) {
    const options = this.options.perception;

    return createPerception({
      vision: { sampleIntervalMs: 6_666, differenceThreshold: 0.03, maxFrames: 9 },
      context: createPerceptionContext,
      ...options,
      retentionMs,
      asr: {
        ...options?.asr,
        modelsPath: join(this.options.dataDir, 'models'),
        speaker: loadVoiceprints(this.options.dataDir),
      },
    });
  }

  // oxlint-disable-next-line eslint/complexity -- 房间资源按创建顺序初始化，并在失败路径中对称释放。
  private async openRoom(room: RoomInfo, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();

    if (!room.live) {
      throw new Error(`直播间 ${room.roomId} 当前未开播`);
    }

    await this.closeVisit('switch');
    signal.throwIfAborted();
    this.setStatus('opening');

    const generation = ++this.visitGeneration;
    let session: CielSession | undefined;
    let kws: KWS | undefined;

    const perception = this.createPerception();

    try {
      await this.options.livePage.open(room.roomId, signal);
      await this.waitUntilReady(room.roomId, generation, signal);

      const startedAt = Date.now();

      session = await this.requireCiel().session(
        createRoomSessionOptions(room, new Date(startedAt)),
      );

      this.applyThinkingLevel(session);
      const playUrl = await this.api.playUrl(room.roomId);
      const wake = this.options.wake ? resolveWakeOptions(this.options.wake) : undefined;

      if (wake) {
        kws = await createKWS({
          modelsPath: join(this.options.dataDir, 'models'),
          keywords: wake.keywords,
          cooldownMs: wake.cooldownMs,
        });
      }

      signal.throwIfAborted();
      const monitor = this.createLiveStatusMonitor(room.roomId, generation, signal);
      this.liveStatusMonitor = monitor;

      const media = new LiveMedia({
        roomId: room.roomId,
        input: playUrl,
        live: true,
        perception,
        kws,
        ffmpegPath: this.options.ffmpegPath,
        onError: error => this.emitError('media', error),
        onStopped: error => monitor.mediaStopped(error),
      });

      const visit = new RoomVisit({
        trace: this.options.trace,
        generation,
        room,
        mode: this.requireStartOptions().mode,
        startedAt,
        session,
        perception,
        media,
        wake: wake && kws ? { kws, options: wake } : undefined,
        minimumThinkIntervalMs: this.options.minimumThinkIntervalMs ?? 5_000,
        periodicObservationMs: this.options.periodicObservationMs ?? 30_000,
        thinkTimeoutMs: this.options.thinkTimeoutMs,
        canSwitch: () => this.canSwitch(startedAt),
        afterRun: () => this.inspectDecision(generation, signal),
        emit: event => this.emit(event),
      });

      this.visit = visit;
      visit.start();
      this.setStatus('watching');
      this.emit({ type: 'room_opened', room, sessionId: session.id });
      monitor.start();
    } catch (error) {
      this.options.livePage.close();

      if (this.visit?.generation === generation) {
        await this.closeVisit('open_failed');
      } else {
        await Promise.all([kws?.close(), session?.close(), perception.close()]);
      }

      throw error;
    }
  }

  private async openRecording(
    room: RoomInfo,
    mode: Extract<StartWatchOptions['mode'], { type: 'recording' }>,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    await this.closeVisit('switch');
    signal.throwIfAborted();
    this.setStatus('opening');

    const generation = ++this.visitGeneration;
    let session: CielSession | undefined;
    // 视频在预处理完成后统一读取，保留整段感知；上限使用 Date 的有效毫秒范围。
    const perception = this.createPerception(8_640_000_000_000_000);

    try {
      const startedAt = Date.now();

      session = await this.requireCiel().session(
        createRoomSessionOptions(room, new Date(startedAt), mode),
      );

      this.applyThinkingLevel(session);
      signal.throwIfAborted();

      const media = new LiveMedia({
        roomId: room.roomId,
        input: mode.source.type === 'url' ? mode.source.url : mode.source.path,
        live: false,
        perception,
        ffmpegPath: this.options.ffmpegPath,
        onError: error => this.emitError('media', error),
        onStopped: error => this.endRecording(generation, signal, error),
        onProgress: (processedSeconds, totalSeconds) =>
          this.emit({
            type: 'video_progress',
            stage: 'extracting',
            processedSeconds,
            totalSeconds,
          }),
      });

      const visit = new RoomVisit({
        trace: this.options.trace,
        generation,
        room,
        mode,
        startedAt,
        session,
        perception,
        media,
        minimumThinkIntervalMs: this.options.minimumThinkIntervalMs ?? 5_000,
        periodicObservationMs: this.options.periodicObservationMs ?? 30_000,
        thinkTimeoutMs: this.options.thinkTimeoutMs,
        canSwitch: () => false,
        afterRun: () => undefined,
        emit: event => this.emit(event),
      });

      this.visit = visit;
      this.emit({ type: 'video_progress', stage: 'extracting' });
      visit.start();
      this.setStatus('watching');
      this.emit({ type: 'room_opened', room, sessionId: session.id });
    } catch (error) {
      if (this.visit?.generation === generation) {
        await this.closeVisit('open_failed');
      } else {
        await Promise.all([session?.close(), perception.close()]);
      }

      throw error;
    }
  }

  private endRecording(generation: number, signal: AbortSignal, error?: Error): void {
    const visit = this.visit;

    if (!visit || visit.generation !== generation || signal.aborted) {
      return;
    }

    if (error) {
      this.emitError('media', error);
    } else {
      this.emit({ type: 'recording_finished', roomId: visit.room.roomId });
    }

    void this.enqueue(async () => {
      if (this.visit !== visit || signal.aborted) {
        return;
      }

      try {
        // 异常中断只清理资源，不能把未读完的录播当作完整内容总结。
        if (!error && !signal.aborted) {
          await visit.finishRecording(signal);
        }
      } catch (cause) {
        if (!signal.aborted) {
          this.emitError('recording_summary', cause);
        }
      } finally {
        await this.stopRuntime();
      }
    }).catch(cause => this.emitError('stop', cause));
  }

  private async inspectDecision(generation: number, signal: AbortSignal): Promise<void> {
    const visit = this.visit;
    const mode = this.requireStartOptions().mode;

    if (
      this.currentStatus !== 'watching' ||
      mode.type !== 'explore' ||
      !visit ||
      visit.generation !== generation ||
      signal.aborted
    ) {
      return;
    }

    const decision = await readRoomDecision(visit.session.agent, signal);

    if (!decision || signal.aborted || this.visit !== visit) {
      return;
    }

    this.emit({
      type: 'room_evaluated',
      action: decision.action,
      confidence: decision.confidence,
      score: decision.score,
    });

    if (!this.canSwitch(visit.startedAt)) {
      return;
    }

    const switchDecision = this.scorePolicy.evaluate(decision);

    if (!switchDecision.shouldSwitch) {
      return;
    }

    // 不在 afterRun 内等待切房，否则 closeVisit 会等待当前调度任务自身。
    void this.enqueue(() => this.explore(mode.areaId, signal, visit)).catch(error => {
      if (!signal.aborted) {
        this.emitError('explore', error);
      }
    });
  }

  private async waitUntilReady(
    roomId: number,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      signal.throwIfAborted();

      if (generation !== this.visitGeneration) {
        throw new Error('等待直播页面时房间已切换');
      }

      const readiness = await this.options.livePage.readiness();

      signal.throwIfAborted();

      if (readiness.ready && readiness.roomId === roomId) {
        return;
      }

      await delay(60);
    }

    throw new Error(`直播间 ${roomId} 页面未在预期时间内就绪`);
  }

  private createLiveStatusMonitor(roomId: number, generation: number, signal: AbortSignal) {
    return new LiveStatusMonitor({
      readStatus: (checkSignal, reason) =>
        readRoomLiveStatus({
          page: this.options.livePage,
          api: this.api,
          roomId,
          signal: checkSignal,
          reason,
        }),
      onOffline: () => this.endVisit(generation, signal, 'offline'),
      onMediaFailure: error => this.endVisit(generation, signal, 'media_failed', error),
      onError: error => this.emitError('live_status', error),
    });
  }

  private endVisit(
    generation: number,
    signal: AbortSignal,
    reason: 'offline' | 'media_failed',
    error?: Error,
  ) {
    const visit = this.visit;

    if (
      !visit ||
      visit.generation !== generation ||
      signal.aborted ||
      this.currentStatus !== 'watching'
    ) {
      return;
    }

    const mode = this.requireStartOptions().mode;
    // 先禁止新弹幕并中止正在思考的 Agent，再排队关闭资源，避免下播后仍发送。
    this.setStatus('stopping');
    visit.cancel();

    if (error) {
      this.emitError('media', error);
    }

    void this.enqueue(async () => {
      if (signal.aborted || this.visit?.generation !== generation) {
        return;
      }

      await this.closeVisit(reason);

      if (reason === 'offline' && mode.type === 'explore') {
        await this.explore(mode.areaId, signal);
      } else {
        await this.stopRuntime();
      }
    }).catch(async cause => {
      if (signal.aborted) {
        return;
      }

      this.emitError('live_status', cause);

      // 重新选房失败也必须退出 stopping/exploring，不能留下无媒体的观看状态。
      try {
        await this.stop();
      } catch (cleanupError) {
        this.emitError('stop', cleanupError);
      }
    });
  }

  private async closeVisit(reason: string): Promise<void> {
    const visit = this.visit;

    this.liveStatusMonitor?.close();
    this.liveStatusMonitor = undefined;
    this.visit = undefined;
    this.visitGeneration += 1;
    this.scorePolicy.reset();

    if (!visit) {
      return;
    }

    // 任何一次离开都算「刚试过这个房间」，切房、下播、停止都一样，不按原因过滤。
    this.roomHistory.record(visit.room);

    if (this.startOptions?.mode.type !== 'recording') {
      this.options.livePage.close();
    }

    await visit.close();

    this.emit({ type: 'room_closed', roomId: visit.room.roomId, reason });
  }

  private async stopRuntime(): Promise<void> {
    if (this.currentStatus === 'closed') {
      return;
    }

    this.setStatus('stopping');
    await this.disposeRuntime();
    this.startOptions = undefined;
    this.setStatus('idle');
  }

  private async disposeRuntime(): Promise<void> {
    await this.closeVisit('stop');
    await this.ciel?.close();
    this.ciel = undefined;
  }

  private async closeRuntime(): Promise<void> {
    // 退出应用直接取消，不能因视频的“停止并总结”延迟关闭。
    this.loginController?.abort();
    this.runController?.abort();
    this.visit?.cancel();
    await this.enqueue(() => this.stopRuntime());
    this.currentStatus = 'closed';
    this.listeners.clear();
  }

  private recordDanmakuEvent(event: WatchEvent): void {
    if (event.type === 'danmaku_submitted') {
      if (this.visit?.room.roomId !== event.roomId) {
        return;
      }

      this.visit.history.push({ content: event.content, sentAt: Date.now() });

      if (this.visit.history.length > 10) {
        this.visit.history.shift();
      }
    }

    this.emit(event);
  }

  private canSwitch(startedAt: number): boolean {
    return (
      this.requireStartOptions().mode.type === 'explore' &&
      Date.now() - startedAt >= ROOM_REVIEW_AFTER_MS
    );
  }

  private requireStartOptions() {
    if (!this.startOptions) {
      throw new Error('Blive Agent 尚未启动');
    }

    return this.startOptions;
  }

  /** 推理强度必须在首次请求前设置，按配置覆盖 Agent 默认值。 */
  private applyThinkingLevel(session: CielSession): void {
    if (this.options.thinkingLevel) {
      session.agent.state.thinkingLevel = this.options.thinkingLevel;
    }
  }

  private requireCiel(): Ciel {
    if (!this.ciel) {
      throw new Error('Ciel 尚未启动');
    }

    return this.ciel;
  }

  private setStatus(status: WatchStatus): void {
    this.currentStatus = status;
    this.emit({ type: 'status', status });
  }

  private emit(event: WatchEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private emitError(stage: string, error: unknown): void {
    this.emit({ type: 'error', stage, error: toError(error) });
  }
}

function validateStartOptions(options: StartWatchOptions): void {
  const value = options.mode.type === 'explore' ? options.mode.areaId : options.mode.roomId;

  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${options.mode.type === 'explore' ? 'areaId' : 'roomId'} 必须是正整数`);
  }

  if (options.mode.type !== 'recording') {
    return;
  }

  if (options.mode.source.type === 'url') {
    const url = URL.parse(options.mode.source.url);

    if (!url || !['http:', 'https:'].includes(url.protocol)) {
      throw new Error('录播 URL 必须是有效的 HTTP 或 HTTPS 地址');
    }
  } else if (!options.mode.source.path.trim()) {
    throw new Error('请选择本地视频文件');
  }

  if (options.mode.date && !isValidDate(options.mode.date)) {
    throw new Error('录播日期必须是有效的 YYYY-MM-DD 日期');
  }
}

function isValidDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);

  if (!match) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
