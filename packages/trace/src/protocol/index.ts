import type { RuntimeRecord } from '@cieljs/agent-kit/protocol';

export interface TraceEntry {
  id: string;
  sequence: number;
  sessionId: string;
  kind: 'message' | 'tool' | 'event';
  name: string;
  label?: string;
  description?: string;
  runId?: string;
  parentRunId?: string;
  turnId?: string;
  turnNumber?: number;
  messageId?: string;
  toolCallId?: string;
  model?: { id: string; name: string; provider: string };
  revision?: number;
  raw?: ValueRef;
  status: 'running' | 'completed' | 'error';
  startedAt: number;
  endedAt?: number;
  text?: string;
  thinking?: string;
  input?: ValueRef;
  output?: ValueRef;
  error?: ValueRef;
  schema?: ValueRef;
}

export interface ValueRef {
  id: string;
  path?: string[];
  preview: string;
}

/** 一次模型调用的用量；只保留展示需要的计数，Pi 的 cost 等字段不进入协议。 */
export interface TraceUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** 缓存写入与读取都算在 total 里，与模型侧口径一致。 */
  total: number;
}

export interface TraceUsageState {
  /**
   * 累计用量：宿主持久化历史记录的累计状态，并从持久化游标继续消费新增事件；
   * 和「执行记录」同源，因此跨宿主重启连续，也不受客户端窗口与「清空视图」影响。
   */
  total: TraceUsage;
  /**
   * 当前上下文规模：最近一次请求的用量；压缩后还没发起新请求时，是摘要加保留原文的
   * 估算；还没有任何请求时为 null。
   */
  context: TraceUsage | null;
}

export interface TraceSession {
  id: string;
  title?: string;
  sources?: string[];
  startedAt: number;
  endedAt: number;
  usage: TraceUsageState;
  turn: number;
  steps: number;
}

export interface TraceUpdate {
  entries: TraceEntry[];
  steps: TraceEntry[];
  usage: TraceUsageState;
  sessions: TraceSession[];
}

export type TraceEvent = RuntimeRecord;
