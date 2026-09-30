import type { MemoryManager } from '@cieljs/memory';
import type { SessionManager } from '@cieljs/session';
import type { Agent, AgentEvent, AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';

import type { SessionSources } from './sources.ts';

export type RuntimeStatus = 'idle' | 'starting' | 'running' | 'closing' | 'closed';

export interface RuntimeCompactionOptions {
  /** 触发压缩的上下文窗口；省略时使用对话模型的 contextWindow。 */
  contextWindow?: number;
  /** 为后续生成预留的 token；省略时由 Session 使用 16384。 */
  reserveTokens?: number;
  /** 至少保留的最近原始消息条数；省略时由 Session 使用 10。 */
  keepRecentMessages?: number;
}

export interface RuntimeOptions {
  model: Model<Api>;
  /** 请求级 API key，不写入全局环境变量或持久化存储。 */
  apiKey?: string;
  systemPrompt: string;
  sessionManager: SessionManager;
  investigationManager: SessionManager;
  memoryManager: MemoryManager;
  tools?: AgentTool[];
  /** 会话上下文压缩；省略时按对话模型的窗口自动压缩。 */
  compaction?: RuntimeCompactionOptions;
  investigation?: {
    systemPrompt?: string;
    tools?: AgentTool[];
  };
}

export interface OpenRuntimeSessionOptions {
  /** 允许工具只读检索其他 Space；默认仅当前 Space。 */
  crossSpace?: boolean;
  sessionId?: string;
  spaceId: string;
  sources?: SessionSources;
}

export type InvestigationTarget =
  | { type: 'global' }
  | {
      type: 'space';
      spaceId: string;
      /** 需要完整分析的普通 Session；与 Investigation 自身的 sessionId 无关。 */
      sessionId?: string;
    };

export interface InvestigateOptions {
  /** 续接 Investigation 自身的独立会话。 */
  sessionId?: string;
  target: InvestigationTarget;
  question: string | AgentMessage[];
  /** 默认只读；写权限始终限制在 target 指定的层级。 */
  memoryAccess?: 'read' | 'read-write';
  /** 单次调查可以覆盖宿主默认提示词，避免不同调查用途互相污染。 */
  systemPrompt?: string;
  /** 允许只读检索目标之外的 Space。 */
  crossSpace?: boolean;
  sources?: SessionSources;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent, context: { tools: AgentTool[]; model: Model<Api> }) => void;
  onTitleUpdated?: (title: string) => void;
}

export interface InvestigationResult {
  sessionId: string;
  answer: AgentMessage;
  messages: AgentMessage[];
}

export interface RuntimeSession extends AsyncDisposable {
  readonly id: string;
  readonly spaceId: string;
  readonly agent: Agent;
  /** 手动压缩上下文：忽略自动触发阈值，返回是否产生了新的压缩摘要。 */
  compact(): Promise<boolean>;
  close(): Promise<void>;
}

export type { SessionSources } from './sources.ts';
