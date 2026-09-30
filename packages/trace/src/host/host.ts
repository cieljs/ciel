import { randomUUID } from 'node:crypto';

import type { RuntimeReader, RuntimeWriter } from '@cieljs/agent-kit/protocol';
import { sql, type Storage } from '@cieljs/storage';
import type { Agent, AgentEvent } from '@earendil-works/pi-agent-core';

import type {
  TraceUpdate,
  TraceSession,
  TraceUsageState,
  TraceEntry,
  TraceEvent,
  ValueRef,
} from '../protocol/index.ts';
import { AgentTrace, type AgentTraceMetadata } from './agent-trace.ts';
import { TraceStore } from './store.ts';
import { preview } from './trace-content.ts';
import { createTraceStep } from './trace-step.ts';
import { TraceUsageTally, type TraceUsageTallyState } from './usage.ts';

interface ProjectionState {
  version: 2;
  /** records 使用 V8 wire format；运行时变化后必须从 JSON Journal 重建。 */
  serializationRuntime: string;
  cursor: number;
  sequence: number;
  tally: TraceUsageTallyState;
  runNumbers: Array<[string, Array<[string, number]>]>;
  sessionProgress: Array<[string, { turn: number; steps: number; seen: string[] }]>;
}

/** 宿主保存独立的完整快照；内存列表淘汰不删除磁盘记录。 */
export class TraceHost implements AsyncDisposable {
  private readonly observers = new Map<string, AgentTrace>();
  private projection = Promise.resolve();
  private projectionFailure: unknown;
  private cursor = 0;
  private unsubscribe?: () => void;
  private currentTrace?: TraceEvent;
  private currentEntrySequence?: number;
  private currentTurnNumber?: number;
  private entryOrdinal = 0;
  private readonly entries = new Map<string, TraceEntry>();
  private readonly listeners = new Set<(update: TraceUpdate) => void>();
  private readonly dirty = new Set<string>();
  private readonly stepChanges = new Map<string, TraceEntry>();
  private readonly tally = new TraceUsageTally();
  /** 轮次按 Agent 运行分配：同一 run 的所有事件共用一个轮次号。 */
  private readonly runNumbers = new Map<string, Map<string, number>>();
  private readonly sessionProgress = new Map<
    string,
    { turn: number; steps: number; seen: Set<string> }
  >();
  private sequence = 0;
  private eventSequence = 0;
  private readonly wakeListeners = new Set<() => void>();
  private closed = false;
  private closing?: Promise<void>;
  private readonly lifetime = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  private projectionStore: TraceStore;
  private rebuilding = false;
  private rebuildCompletion?: Promise<void>;

  get signal() {
    return this.lifetime.signal;
  }

  private constructor(
    readonly storage: Storage,
    private readonly source: RuntimeReader,
    private readonly writer: RuntimeWriter,
    readonly store: TraceStore,
    private readonly capacity = 300,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error('capacity 必须是正整数');
    }

    this.projectionStore = store;
  }

  private get persistsProjectionState() {
    return this.source === this.storage.journal && this.writer === this.storage.journal;
  }

  static async open(options: {
    storage: Storage;
    source?: RuntimeReader;
    writer?: RuntimeWriter;
    capacity?: number;
    /** 历史重放是否在 open() 内完成。后台重放与之共用 projection 链，顺序和最终状态不变。 */
    awaitReplay?: boolean;
  }) {
    const store = await TraceStore.open(options.storage);

    const host = new TraceHost(
      options.storage,
      options.source ?? options.storage.journal,
      options.writer ?? options.storage.journal,
      store,
      options.capacity,
    );

    host.sequence = await host.store.sequence();

    if (host.persistsProjectionState) {
      await host.prepareProjection();
    }

    host.unsubscribe = host.source.subscribe(() => {
      // 失败保留在 projection 中，由 flushRecords/close 向调用者报告。
      void host.catchUp().catch(() => {});
    });

    if (options.awaitReplay ?? true) {
      await host.catchUp();
      await host.finishProjection();
    } else {
      // 重放历史随会话数增长，不能在窗口显示前等它跑完；完成后补一次推送，
      // 让只依赖重放的用量快照也能上屏。
      void host
        .catchUp()
        .then(() => host.finishProjection())
        .catch(error => host.captureProjectionFailure(error))
        .finally(() => {
          if (!host.closed) {
            host.scheduleFlush();
          }
        });
    }

    return host;
  }

  private catchUp() {
    this.projection = this.projection.then(async () => {
      while (!this.closed) {
        const records = await this.source.read(this.cursor);

        if (!records.length) {
          return;
        }

        for (const trace of records) {
          const entryId = trace.event.type.startsWith('message_')
            ? trace.messageId!
            : `${trace.id}:0`;

          const previous = await this.projectionStore.get<TraceEntry>(entryId);

          let observer = this.observers.get(trace.sessionId);

          if (!observer) {
            observer = new AgentTrace(trace.sessionId, {
              createEntry: (id, kind, name) => this.createEntry(id, kind, name),
              saveEntry: entry => this.saveEntry(entry),
              storeValue: (id, value) => this.storeValue(id, value),
            });

            this.observers.set(trace.sessionId, observer);
          }

          this.currentTrace = trace;
          this.currentEntrySequence = previous?.sequence;
          this.currentTurnNumber = this.resolveTurnNumber(trace);
          this.entryOrdinal = 0;
          this.eventSequence = trace.sequence;
          this.tally.consume(trace);
          observer.receive(trace);
          this.saveEvent(trace, trace.metadata);
          this.currentTrace = undefined;
          this.currentEntrySequence = undefined;
          this.currentTurnNumber = undefined;
          this.cursor = trace.sequence;
        }

        if (records.some(record => !record.transient)) {
          await this.persistProjectionState();
        }
      }
    });

    // 后台失败不能只留在 Promise 链中，否则界面会永久停在旧快照。
    void this.projection.catch(error => this.captureProjectionFailure(error));

    return this.projection;
  }

  private captureProjectionFailure(error: unknown) {
    if (this.projectionFailure) {
      return;
    }

    this.projectionFailure = error;
    const cause = error instanceof Error ? (error.cause ?? error) : error;
    console.error('Trace 事件处理失败', cause instanceof Error ? cause.message : String(cause));
    this.scheduleFlush();
  }

  assertHealthy() {
    if (this.projectionFailure) {
      throw new Error('Trace 事件处理失败，请检查主进程日志中的存储错误');
    }
  }

  async flushRecords() {
    await this.writer.flush();
    await this.catchUp();
    await this.persistProjectionState();
    await this.finishProjection();
    await this.store.flush();
  }

  /** 会话用量的当前快照；重放后即可用，不依赖客户端加载到哪些记录。 */
  usage(): TraceUsageState {
    return this.tally.snapshot();
  }

  sessions(): TraceSession[] {
    return this.tally.sessions().map(session => {
      const progress = this.sessionProgress.get(session.id);

      return { ...session, turn: progress?.turn ?? 0, steps: progress?.steps ?? 0 };
    });
  }

  subscribe(listener: (update: TraceUpdate) => void) {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  record(name: string, output: unknown, sessionId = 'blive-agent') {
    const entry = this.createEntry(sessionId, 'event', name);
    entry.status = 'completed';
    entry.endedAt = Date.now();
    entry.output = this.storeValue(`${entry.id}:output`, output);
    this.saveEntry(entry);
  }

  /** 展示感知输入，不伪造 Agent 事件，也不重复写入模型会话。 */
  recordMessage(label: string, content: string, sessionId: string) {
    const entry = this.createEntry(sessionId, 'message', 'perception');
    entry.label = label;
    entry.status = 'completed';
    entry.endedAt = Date.now();
    entry.output = this.storeValue(`${entry.id}:output`, content);
    this.saveEntry(entry);
  }

  observe(agent: Pick<Agent, 'subscribe' | 'state'>, sessionId: string) {
    const receive = this.agentListener(sessionId, () => ({
      tools: agent.state.tools,
      model: agent.state.model,
    }));

    return agent.subscribe(async event => {
      await receive(event);
    });
  }

  /** 创建独立的 Agent 事件归并器；宿主只分配序号并保存归并结果。 */
  agentListener(sessionId: string, metadata?: () => AgentTraceMetadata) {
    return (event: AgentEvent, context?: AgentTraceMetadata) => {
      if (this.closed) {
        return;
      }

      return this.writer.record(sessionId, event, { ...metadata?.(), ...context });
    };
  }

  private saveEvent(trace: TraceEvent, metadata: AgentTraceMetadata) {
    // 外部日志没有本地事件表记录，保留快照以支持同样的详情引用。
    if (this.source !== this.storage.journal && !trace.transient) {
      this.put(trace.id, 'value', trace.sequence, trace, trace.runId, trace.sessionId);
    }

    const step = createTraceStep(trace, metadata.tools, metadata.model);

    if (trace.transient) {
      step.raw = undefined;
      step.output = this.transientOutput(step);
    }

    step.turnNumber = this.currentTurnNumber;
    this.trackSessionProgress(step);

    if (!trace.transient) {
      this.put(step.id, 'step', trace.sequence, step, trace.runId, trace.sessionId);
    }

    this.stepChanges.set(step.id, step);
    this.scheduleFlush();

    for (const wake of this.wakeListeners) {
      wake();
    }
  }

  private transientOutput(step: TraceEntry) {
    if (step.messageId) {
      return this.entries.get(step.messageId)?.output;
    }

    if (!step.toolCallId) {
      return;
    }

    return [...this.entries.values()].find(entry => entry.toolCallId === step.toolCallId)?.output;
  }

  async *events(afterSequence = 0, signal?: AbortSignal): AsyncGenerator<TraceEvent> {
    let wake: (() => void) | undefined;
    const notify = () => wake?.();
    this.wakeListeners.add(notify);
    signal?.addEventListener('abort', notify);

    try {
      while (!this.closed && !signal?.aborted) {
        const pending = new Promise<void>(resolve => {
          wake = resolve;
        });

        // 先安装唤醒器，再读水位，避免快照和订阅之间丢事件。
        const events = await this.source.read(afterSequence, 100);

        for (const event of events) {
          if (this.closed || signal?.aborted) {
            return;
          }

          afterSequence = event.sequence;
          yield event;
        }

        if (!events.length) {
          await pending;
        }
      }
    } finally {
      this.wakeListeners.delete(notify);
      signal?.removeEventListener('abort', notify);
    }
  }

  close(): Promise<void> {
    this.closing ??= this.closeResources();

    return this.closing;
  }

  private async closeResources() {
    this.unsubscribe?.();

    try {
      await this.flushRecords();
    } finally {
      this.closed = true;
      this.lifetime.abort();
      this.stepChanges.clear();

      for (const wake of this.wakeListeners) {
        wake();
      }

      clearTimeout(this.timer);
      this.listeners.clear();
      this.entries.clear();
      this.dirty.clear();
    }
  }

  [Symbol.asyncDispose]() {
    return this.close();
  }

  private createEntry(sessionId: string, kind: TraceEntry['kind'], name: string): TraceEntry {
    return {
      id: this.currentTrace ? `${this.currentTrace.id}:${this.entryOrdinal++}` : randomUUID(),
      // 对话投影与宿主感知共用顺序；原始 Agent 事件序号仅用于执行记录。
      // 重放只恢复投影状态，已有记录沿用原顺序，不能挤到新消息之后。
      sequence: this.currentEntrySequence ?? ++this.sequence,
      sessionId,
      kind,
      name,
      status: 'running',
      startedAt: this.currentTrace?.timestamp ?? Date.now(),
    };
  }

  private storeValue(id: string, value: unknown): ValueRef {
    const trace = this.currentTrace;

    if (trace?.transient) {
      this.projectionStore.putTransient(id, value);

      return { id, preview: preview(value) };
    }

    const sharedMessage =
      this.source === this.storage.journal &&
      trace?.event.type.startsWith('message_') &&
      id === `${trace.messageId}:output`;

    if (sharedMessage && trace) {
      this.put(id, 'message_reference', this.eventSequence, trace.id, trace.runId, trace.sessionId);
    } else {
      this.put(id, 'value', this.eventSequence, value, trace?.runId, trace?.sessionId);
    }

    return { id, preview: preview(value) };
  }

  private saveEntry(entry: TraceEntry) {
    entry.turnNumber ??= this.currentTurnNumber;
    this.tally.touch(entry.sessionId, entry.endedAt ?? entry.startedAt);

    if (!this.currentTrace?.transient) {
      this.put(entry.id, 'entry', entry.sequence, entry, entry.runId, entry.sessionId);

      if (entry.name === 'agent_start') {
        this.put(`run:${entry.id}`, 'run', entry.sequence, entry, entry.runId, entry.sessionId);
      }
    }

    this.entries.set(entry.id, { ...entry });
    this.dirty.add(entry.id);

    // 淘汰只影响推送摘要的缓存，磁盘中的完整事件仍可按 ID 和游标查询。
    while (this.entries.size > this.capacity) {
      const id = this.entries.keys().next().value!;
      this.entries.delete(id);
      this.dirty.delete(id);
    }

    this.scheduleFlush();
  }

  /** 一轮 = 一次 Agent 运行，所以按 runId 计数；同一 run 的后续事件沿用已分配的号。 */
  private resolveTurnNumber(trace: TraceEvent) {
    if (!trace.runId) {
      return;
    }

    const sessionKey = trace.sessionId;
    let sessionRuns = this.runNumbers.get(sessionKey);

    if (!sessionRuns) {
      sessionRuns = new Map();
      this.runNumbers.set(sessionKey, sessionRuns);
    }

    const existing = sessionRuns.get(trace.runId);

    if (existing) {
      return existing;
    }

    const turnNumber = sessionRuns.size + 1;
    sessionRuns.set(trace.runId, turnNumber);

    return turnNumber;
  }

  // oxlint-disable-next-line eslint/complexity -- 不同 Trace 协议事件需要归一为稳定的进度去重键。
  private trackSessionProgress(step: TraceEntry) {
    let progress = this.sessionProgress.get(step.sessionId);

    if (!progress) {
      progress = { turn: 0, steps: 0, seen: new Set() };
      this.sessionProgress.set(step.sessionId, progress);
    }

    if (step.turnNumber) {
      progress.turn = step.turnNumber;
    }

    const scope = JSON.stringify([step.sessionId, step.runId]);
    const isToolResult = step.kind === 'message' && step.label === 'toolResult';
    let key = step.id;

    if ((step.kind === 'tool' || isToolResult) && step.toolCallId) {
      key = `${scope}:tool:${step.toolCallId}`;
    } else if (step.kind === 'message' && step.messageId) {
      key = `${scope}:message:${step.messageId}`;
    } else if (/^agent_(start|end)$/.test(step.name) && step.runId) {
      key = `${scope}:agent`;
    } else if (/^turn_(start|end)$/.test(step.name) && step.turnId) {
      key = `${scope}:turn:${step.turnId}`;
    }

    if (step.name === 'agent_start') {
      progress.seen.clear();
    }

    if (!progress.seen.has(key)) {
      progress.seen.add(key);
      progress.steps += 1;
    }

    if (step.name === 'agent_end') {
      progress.seen.clear();
    }
  }

  private projectionState(): ProjectionState {
    return {
      version: 2,
      serializationRuntime: process.versions.v8,
      cursor: this.cursor,
      sequence: this.sequence,
      tally: this.tally.state(),
      runNumbers: [...this.runNumbers].map(([sessionId, runs]) => [sessionId, [...runs]]),
      sessionProgress: [...this.sessionProgress].map(([sessionId, progress]) => [
        sessionId,
        { turn: progress.turn, steps: progress.steps, seen: [...progress.seen] },
      ]),
    };
  }

  private async prepareProjection() {
    let state: ProjectionState | undefined;
    let stateReadFailed = false;

    try {
      state = await this.store.projectionState<ProjectionState>();
    } catch (error) {
      stateReadFailed = true;
      console.warn('Trace 投影状态不可读，将在后台重建', error);
    }

    const latest = await this.storage.db.execute<{ sequence: string }>(sql`
      SELECT COALESCE(MAX(sequence), 0) AS sequence FROM storage.events
    `);

    const latestSequence = Number(latest.rows[0]!.sequence);

    if (state && isProjectionState(state) && state.cursor <= latestSequence) {
      this.restoreProjectionState(state);

      return;
    }

    if (!state && !stateReadFailed && latestSequence === 0) {
      return;
    }

    this.projectionStore = await this.store.createRebuild();
    this.rebuilding = true;
    this.cursor = 0;
  }

  private restoreProjectionState(state: ProjectionState) {
    this.cursor = state.cursor;
    this.sequence = Math.max(this.sequence, state.sequence);
    this.tally.restore(state.tally);

    for (const [sessionId, runs] of state.runNumbers) {
      this.runNumbers.set(sessionId, new Map(runs));
    }

    for (const [sessionId, progress] of state.sessionProgress) {
      this.sessionProgress.set(sessionId, { ...progress, seen: new Set(progress.seen) });
    }
  }

  private async persistProjectionState() {
    if (!this.persistsProjectionState) {
      return;
    }

    this.projectionStore.saveProjectionState(this.sequence, this.projectionState());
    await this.projectionStore.flush();
  }

  private async finishProjection() {
    if (!this.rebuilding) {
      return;
    }

    this.rebuildCompletion ??= this.store.activate(this.projectionStore).then(() => {
      this.rebuilding = false;
    });

    await this.rebuildCompletion;
  }

  private put(
    id: string,
    category: string,
    sequence: number,
    value: unknown,
    runId?: string,
    sessionId?: string,
  ) {
    this.projectionStore.put(id, category, sequence, value, runId, sessionId);

    if (this.rebuilding && !this.currentTrace) {
      this.store.put(id, category, sequence, value, runId, sessionId);
    }
  }

  // 将同一批 token 的摘要合并后推送，原始事件已即时落盘，不受节流影响。
  private scheduleFlush() {
    this.timer ??= setTimeout(() => this.flush(), 60);
  }

  private flush() {
    clearTimeout(this.timer);
    this.timer = undefined;

    const update = {
      entries: [...this.dirty].flatMap(id => this.entries.get(id) ?? []),
      steps: [...this.stepChanges.values()],
      usage: this.tally.snapshot(),
      sessions: this.sessions(),
    };

    this.dirty.clear();
    this.stepChanges.clear();

    for (const listener of this.listeners) {
      listener(update);
    }
  }
}

function isProjectionState(state: ProjectionState) {
  return (
    state.version === 2 &&
    state.serializationRuntime === process.versions.v8 &&
    Number.isSafeInteger(state.cursor) &&
    state.cursor >= 0 &&
    Number.isSafeInteger(state.sequence) &&
    state.sequence >= 0 &&
    isUsageTallyState(state.tally) &&
    Array.isArray(state.runNumbers) &&
    state.runNumbers.every(
      item =>
        Array.isArray(item) &&
        typeof item[0] === 'string' &&
        Array.isArray(item[1]) &&
        item[1].every(
          run =>
            Array.isArray(run) &&
            typeof run[0] === 'string' &&
            Number.isSafeInteger(run[1]) &&
            run[1] >= 0,
        ),
    ) &&
    Array.isArray(state.sessionProgress) &&
    state.sessionProgress.every(
      item =>
        Array.isArray(item) &&
        typeof item[0] === 'string' &&
        Number.isSafeInteger(item[1]?.turn) &&
        item[1].turn >= 0 &&
        Number.isSafeInteger(item[1]?.steps) &&
        item[1].steps >= 0 &&
        Array.isArray(item[1]?.seen) &&
        item[1].seen.every(value => typeof value === 'string'),
    )
  );
}

function isUsageTallyState(state: TraceUsageTallyState) {
  return (
    isUsage(state?.total) &&
    (state.context === null || isUsage(state.context)) &&
    (state.contextSessionId === null || typeof state.contextSessionId === 'string') &&
    Array.isArray(state.sessions) &&
    state.sessions.every(
      session =>
        typeof session.id === 'string' &&
        Number.isFinite(session.startedAt) &&
        Number.isFinite(session.endedAt) &&
        isUsage(session.total) &&
        (session.context === null || isUsage(session.context)),
    )
  );
}

function isUsage(value: TraceUsageTallyState['total']) {
  return [value?.input, value?.output, value?.cacheRead, value?.cacheWrite, value?.total].every(
    item => Number.isFinite(item) && item! >= 0,
  );
}
