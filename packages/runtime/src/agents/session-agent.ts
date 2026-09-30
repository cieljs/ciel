import type { MemoryManager } from '@cieljs/memory';
import { globalMemoryTools, memoryTools } from '@cieljs/memory/agent';
import type { Session, SessionManager } from '@cieljs/session';
import { sessionTools } from '@cieljs/session/agent';
import type { Agent, AgentTool } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';
import { streamSimple } from '@earendil-works/pi-ai/compat';

import type { RuntimeCompactionOptions } from '../types.ts';
import { createSessionSummarizer } from './compaction.ts';
import { createSessionContextTransformer } from './context.ts';
import { ManagedAgent } from './managed-agent.ts';
import { createSessionSourceSync } from './session-sources.ts';
import { assertUniqueTools } from './tools.ts';

export class SessionAgentHandle {
  private closePromise: Promise<void> | undefined;

  constructor(
    readonly agent: Agent,
    readonly session: Session,
    private readonly unsubscribe: () => void,
    private readonly markClosed: () => void,
    private readonly onClose: (handle: SessionAgentHandle) => void,
    /** 手动压缩当前上下文：忽略自动阈值，返回是否产生了新的压缩摘要。 */
    readonly compactContext: () => Promise<boolean>,
  ) {}

  close(): Promise<void> {
    this.closePromise ??= this.closeAgent();

    return this.closePromise;
  }

  private async closeAgent() {
    await using disposables = new AsyncDisposableStack();
    disposables.defer(() => this.onClose(this));
    disposables.defer(() => this.unsubscribe());

    this.markClosed();
    await this.agent.waitForIdle();
  }
}

export async function createRuntimeSessionAgent(options: {
  model: Model<Api>;
  apiKey?: string;
  systemPrompt: string;
  tools: AgentTool[];
  sessionManager: SessionManager;
  memoryManager: MemoryManager;
  sessionId?: string;
  spaceId: string;
  crossSpace?: boolean;
  compaction?: RuntimeCompactionOptions;
  resolveSources: () => string[];
  assertRunning: () => void;
  onClose: (handle: SessionAgentHandle) => void;
}): Promise<SessionAgentHandle> {
  const sessionSpace = options.sessionManager.space(options.spaceId);
  const memorySpace = options.memoryManager.space(options.spaceId);
  const initialSources = options.resolveSources();

  const session = await sessionSpace.openSession({
    id: options.sessionId,
    sources: initialSources,
  });

  const messages = await session.context();
  let sessionInfo = await session.getInfo();

  const { refreshSources, resolveAndRefreshSources } = createSessionSourceSync(
    session,
    initialSources,
    options.resolveSources,
    updated => {
      sessionInfo = updated;
    },
  );

  const tools = [
    ...options.tools,
    ...sessionTools({
      session,
      space: sessionSpace,
      onSessionUpdated: updated => {
        sessionInfo = updated;
      },
      crossSpace: options.crossSpace
        ? { manager: options.sessionManager, access: 'related' }
        : undefined,
    }),
    ...memoryTools({
      space: memorySpace,
      crossSpace: options.crossSpace
        ? { manager: options.memoryManager, access: 'related' }
        : undefined,
      sources: () => [`session:${session.id}`, ...options.resolveSources()],
    }),
    ...globalMemoryTools({
      memory: options.memoryManager.global,
      sources: () => [`session:${session.id}`, ...options.resolveSources()],
    }),
  ];

  assertUniqueTools(tools);

  const summarize = createSessionSummarizer(options.model, options.apiKey);

  let isClosed = false;

  // 自动路径每次运行前检查一次；手动路径忽略阈值，但同样只改模型可见的上下文，
  // Agent 转录必须同步为压缩后的结果。
  const compactSession = async (force = false) => {
    const result = await session.compact({
      summarize,
      contextWindow: options.compaction?.contextWindow ?? options.model.contextWindow,
      reserveTokens: options.compaction?.reserveTokens,
      keepRecentMessages: options.compaction?.keepRecentMessages,
      force,
    });

    if (result) {
      agent.state.messages = await session.context();
    }

    return result !== null;
  };

  // 等当前运行结束再改转录，避免中途替换正在使用的消息。
  const compactContext = async () => {
    await agent.waitForIdle();

    return compactSession(true);
  };

  const agent = new ManagedAgent({
    sessionId: session.id,
    streamFn: (model, context, streamOptions) =>
      streamSimple(model, context, { ...streamOptions, apiKey: options.apiKey }),
    prepareRun: async () => {
      options.assertRunning();

      if (isClosed) {
        throw new Error(`Session 已关闭：${session.id}`);
      }

      await resolveAndRefreshSources();
      await compactSession();
    },
    beforeToolCall: resolveAndRefreshSources,
    transformContext: createSessionContextTransformer({
      manager: options.memoryManager,
      space: memorySpace,
      spaceId: options.spaceId,
      resolveSources: options.resolveSources,
      refreshSources,
    }),
    initialState: {
      model: options.model,
      systemPrompt: options.systemPrompt,
      messages,
      tools,
    },
  });

  const unsubscribe = agent.subscribe(async event => {
    await session.recordEvent(event, {
      tools,
      model: options.model,
      session: { title: sessionInfo.title, sources: sessionInfo.sources },
    });
  });

  return new SessionAgentHandle(
    agent,
    session,
    unsubscribe,
    () => {
      isClosed = true;
    },
    options.onClose,
    compactContext,
  );
}
