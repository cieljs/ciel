import type { RuntimeRecord } from '@cieljs/agent-kit/protocol';

import type { TraceSession, TraceUsageState, TraceUsage } from '../protocol/index.ts';

type Usage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
};

type SessionUsageState = {
  title?: string;
  sources?: string[];
  startedAt: number;
  endedAt: number;
  total: TraceUsage;
  context: TraceUsage | null;
};

export interface TraceUsageTallyState {
  total: TraceUsage;
  context: TraceUsage | null;
  contextSessionId: string | null;
  sessions: Array<{
    id: string;
    title?: string;
    sources?: string[];
    startedAt: number;
    endedAt: number;
    total: TraceUsage;
    context: TraceUsage | null;
  }>;
}

/**
 * 累计模型用量。message_end 是每条 assistant 消息唯一一次收尾，按它求和不会像
 * message_update 那样把同一次请求重复计入；宿主关闭时持久化累计状态，重启后只消费新增事件。
 */
export class TraceUsageTally {
  private readonly total = empty();
  private context: TraceUsage | null = null;
  private contextSessionId: string | null = null;
  private readonly sessionStates = new Map<string, SessionUsageState>();

  consume(record: RuntimeRecord) {
    const session = this.touch(record.sessionId, record.timestamp);

    if (record.metadata.session?.title) {
      session.title = record.metadata.session.title;
    }

    if (record.metadata.session?.sources) {
      session.sources = [...record.metadata.session.sources];
    }

    if (record.event.type === 'session_compaction') {
      // 压缩换了上下文，保留消息里的旧 usage 不再代表当前规模；先用摘要加保留原文的
      // 估算顶上，等下一次真实请求再覆盖。缺估算的旧记录只能清空。
      const context = contextFromTokens(record.event.contextTokens);
      session.context = context;

      if (this.contextSessionId === record.sessionId) {
        this.context = context;
      }

      return;
    }

    if (record.event.type !== 'message_end') {
      return;
    }

    const usage = assistantUsage(record.event.message);

    if (!usage) {
      return;
    }

    this.context = usage;
    this.contextSessionId = record.sessionId;
    session.context = usage;
    addUsage(this.total, usage);
    addUsage(session.total, usage);
  }

  touch(sessionId: string, timestamp: number): SessionUsageState {
    const existing = this.sessionStates.get(sessionId);

    if (existing) {
      existing.startedAt = Math.min(existing.startedAt, timestamp);
      existing.endedAt = Math.max(existing.endedAt, timestamp);

      return existing;
    }

    const session = { startedAt: timestamp, endedAt: timestamp, total: empty(), context: null };
    this.sessionStates.set(sessionId, session);

    return session;
  }

  snapshot(sessionId?: string): TraceUsageState {
    if (sessionId) {
      const session = this.sessionStates.get(sessionId);

      if (!session) {
        return { total: empty(), context: null };
      }

      return { total: { ...session.total }, context: session.context && { ...session.context } };
    }

    return { total: { ...this.total }, context: this.context };
  }

  sessions(): TraceSession[] {
    return [...this.sessionStates.entries()]
      .map(([id, session]) => ({
        id,
        title: session.title,
        sources: session.sources && [...session.sources],
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        usage: this.snapshot(id),
        turn: 0,
        steps: 0,
      }))
      .sort((left, right) => left.startedAt - right.startedAt);
  }

  state(): TraceUsageTallyState {
    return {
      total: { ...this.total },
      context: this.context && { ...this.context },
      contextSessionId: this.contextSessionId,
      sessions: [...this.sessionStates].map(([id, session]) => ({
        id,
        title: session.title,
        sources: session.sources && [...session.sources],
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        total: { ...session.total },
        context: session.context && { ...session.context },
      })),
    };
  }

  restore(state: TraceUsageTallyState) {
    Object.assign(this.total, state.total);
    this.context = state.context && { ...state.context };
    this.contextSessionId = state.contextSessionId;
    this.sessionStates.clear();

    for (const session of state.sessions) {
      this.sessionStates.set(session.id, {
        title: session.title,
        sources: session.sources && [...session.sources],
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        total: { ...session.total },
        context: session.context && { ...session.context },
      });
    }
  }
}

function addUsage(target: TraceUsage, usage: TraceUsage) {
  target.input += usage.input;
  target.output += usage.output;
  target.cacheRead += usage.cacheRead;
  target.cacheWrite += usage.cacheWrite;
  target.total += usage.total;
}

function empty(): TraceUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

/** 压缩后的上下文只有总量估算，输入项留空；缓存命中率用的是累计量，不受影响。 */
function contextFromTokens(tokens: number | undefined): TraceUsage | null {
  if (tokens === undefined || !Number.isFinite(tokens) || tokens <= 0) {
    return null;
  }

  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: tokens };
}

/**
 * 只认带有效用量的 assistant 消息；错误和中断的请求同样计入了消耗，不能按 stopReason 丢弃。
 * 但对不上号的零用量（例如还没产出就被中止）既不计入累计，也不该顶替当前上下文。
 */
function assistantUsage(message: unknown): TraceUsage | null {
  const value = message as { role?: unknown; usage?: Partial<Usage> };

  if (value?.role !== 'assistant' || !value.usage) {
    return null;
  }

  const usage = value.usage;
  const counts = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.totalTokens];

  if (!counts.every(count => Number.isFinite(count) && count! >= 0)) {
    return null;
  }

  const { input = 0, output = 0, cacheRead = 0, cacheWrite = 0 } = usage;
  const total = usage.totalTokens || input + output + cacheRead + cacheWrite;

  if (total <= 0) {
    return null;
  }

  return { input, output, cacheRead, cacheWrite, total };
}
