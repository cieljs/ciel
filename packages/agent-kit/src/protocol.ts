import type { Agent, AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core';

export type { AgentEvent, AgentMessage };

export interface RuntimeMetadata {
  tools?: Array<Omit<Agent['state']['tools'][number], 'execute'>>;
  model?: Agent['state']['model'];
  parentRunId?: string;
  session?: {
    title?: string;
    sources?: string[];
  };
}

/** 会话压缩产生的运行时事件；不属于 Pi Agent 事件，但共用同一条事实流水。 */
export interface SessionCompactionEvent {
  type: 'session_compaction';
  summary: string;
  throughSeq: number;
  createdAt: number;
  /**
   * 压缩后的上下文 token 估算（摘要加保留的原文），供 Trace 等消费者立即更新
   * 「当前上下文」；旧记录可能没有这个字段。不含系统提示与工具定义开销。
   */
  contextTokens?: number;
}

/** 写入流水的事件：Pi Agent 事件，加上宿主自己的运行时事件。 */
export type RuntimeEvent = AgentEvent | SessionCompactionEvent;

export interface RuntimeRecord {
  version: 1;
  id: string;
  sequence: number;
  sessionId: string;
  runId: string;
  turnId?: string;
  messageId?: string;
  toolCallId?: string;
  parentRunId?: string;
  timestamp: number;
  /** 高频流式更新只参与当前进程分发，不写入事实流水。 */
  transient?: boolean;
  event: RuntimeEvent;
  metadata: RuntimeMetadata;
}

/** 订阅只是唤醒信号，消费者应按持久化游标读取，避免断线丢失事件。 */
export interface RuntimeReader {
  read(after?: number, limit?: number): Promise<RuntimeRecord[]>;
  subscribe(listener: () => void): () => void;
}

export interface RuntimeWriter {
  record(
    sessionId: string,
    event: RuntimeEvent,
    metadata?: RuntimeMetadata,
  ): Promise<RuntimeRecord>;
  flush(): Promise<void>;
}
