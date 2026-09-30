import type { Storage } from '@cieljs/storage';
import type { VectorService } from '@cieljs/vector';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

export type { EmbeddingOptions, EmbeddingProvider } from '@cieljs/model-kit';

export type SessionSource = string;

export interface SessionInfo {
  id: string;
  spaceId: string;
  title?: string;
  sources: SessionSource[];
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionOptions {
  id?: string;
  title?: string;
  sources?: SessionSource[];
}

export interface UpdateSessionInput {
  title?: string;
  sources?: SessionSource[];
}

export interface SessionListOptions {
  limit?: number;
  offset?: number;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  seq: number;
  message: AgentMessage;
  createdAt: Date;
}

export interface SessionMessageListOptions {
  afterSeq?: number;
  limit?: number;
}

export interface SummarizeInput {
  sessionId: string;
  /** 上次累计摘要；本次应结合新增历史生成完整的新摘要。 */
  summary: string | null;
  messages: AgentMessage[];
  signal?: AbortSignal;
}

export type SessionSummarizer = (input: SummarizeInput) => Promise<string>;

export interface CompactionOptions {
  summarize: SessionSummarizer;
  /** 至少保留最新多少条原始消息，默认 10；切分时保留完整用户轮次。 */
  keepRecentMessages?: number;
  /** 对话模型的上下文窗口大小，单位为 token。 */
  contextWindow: number;
  /** 为后续生成预留的 token，默认 16384，与 Pi 一致。 */
  reserveTokens?: number;
  /** 忽略触发阈值，仍遵守保留数量与轮次边界。 */
  force?: boolean;
  signal?: AbortSignal;
}

export interface SessionContext {
  summary: string | null;
  messages: AgentMessage[];
}

export interface AppendCompactionInput {
  /** 乐观并发检查：摘要所基于的旧边界，首次压缩为 0。 */
  expectedThroughSeq?: number;
  summary: string;
  throughSeq: number;
}

export interface SessionCompaction {
  id: string;
  sessionId: string;
  throughSeq: number;
  summary: string;
  createdAt: Date;
}

export type SessionSearchMode = 'hybrid' | 'full_text' | 'trigram' | 'vector';
export type SessionSearchMatch = 'full_text' | 'trigram' | 'vector';

export interface SessionSearchOptions {
  mode?: SessionSearchMode;
  limit?: number;
  offset?: number;
  candidateLimit?: number;
  minVectorSimilarity?: number;
  signal?: AbortSignal;
}

export type SearchAllSessionsOptions = SessionSearchOptions;

export interface SessionSearchHit {
  spaceId: string;
  message: SessionMessage;
  excerpt: string;
  score: number;
  matches: SessionSearchMatch[];
}

export type SessionSourceSearchMode = 'auto' | 'exact' | 'text';

export interface FindSessionsBySourceOptions {
  mode?: SessionSourceSearchMode;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

export interface SessionSourceHit {
  session: SessionInfo;
  matchedSources: SessionSource[];
  score: number;
}

export interface SessionManagerOptions {
  storage: Storage;
  namespace: string;
  vectors?: VectorService;
  tokenize?: (text: string) => string[];
  onIndexError?: (error: unknown) => void;
}

export interface SessionIndexStatus {
  pending: number;
  ready: number;
  failed: number;
}

/** @internal */
export interface SessionChunk {
  id: string;
  content: string;
}
