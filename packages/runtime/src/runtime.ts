import { runInvestigation } from './agents/investigation-agent.ts';
import { createRuntimeSessionAgent, type SessionAgentHandle } from './agents/session-agent.ts';
import { createSourceResolver } from './sources.ts';
import type {
  InvestigateOptions,
  InvestigationResult,
  OpenRuntimeSessionOptions,
  RuntimeOptions,
  RuntimeSession,
  RuntimeStatus,
} from './types.ts';

class RuntimeSessionInstance implements RuntimeSession {
  readonly id: string;
  readonly spaceId: string;
  readonly agent: RuntimeSession['agent'];

  constructor(private readonly handle: SessionAgentHandle) {
    this.id = handle.session.id;
    this.spaceId = handle.session.spaceId;
    this.agent = handle.agent;
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  compact() {
    return this.handle.compactContext();
  }

  close() {
    return this.handle.close();
  }
}

export class Runtime implements AsyncDisposable {
  private currentStatus: RuntimeStatus = 'idle';
  private startPromise: Promise<void> | undefined;
  private closePromise: Promise<void> | undefined;
  private readonly sessions = new Set<SessionAgentHandle>();
  private readonly sessionOpenings = new Set<Promise<SessionAgentHandle>>();
  private readonly investigations = new Set<Promise<unknown>>();

  constructor(private readonly options: RuntimeOptions) {}

  get status(): RuntimeStatus {
    return this.currentStatus;
  }

  start(): Promise<void> {
    if (this.closePromise) {
      return Promise.reject(new Error('Runtime 已开始关闭'));
    }

    if (this.currentStatus === 'running') {
      return Promise.resolve();
    }

    if (this.currentStatus === 'starting' && this.startPromise) {
      return this.startPromise;
    }

    if (this.currentStatus === 'closing' || this.currentStatus === 'closed') {
      return Promise.reject(new Error(`Runtime 已开始关闭：${this.currentStatus}`));
    }

    this.currentStatus = 'starting';
    this.startPromise = this.startResources();

    return this.startPromise;
  }

  async session(options: OpenRuntimeSessionOptions): Promise<RuntimeSession> {
    this.assertRunning();

    const resolveSources = createSourceResolver(options.sources);

    const opening = createRuntimeSessionAgent({
      model: this.options.model,
      apiKey: this.options.apiKey,
      systemPrompt: this.options.systemPrompt,
      tools: this.options.tools ?? [],
      sessionManager: this.options.sessionManager,
      memoryManager: this.options.memoryManager,
      sessionId: options.sessionId,
      spaceId: options.spaceId,
      crossSpace: options.crossSpace,
      compaction: this.options.compaction,
      resolveSources,
      assertRunning: this.assertRunning.bind(this),
      onClose: this.removeSession.bind(this),
    });

    this.sessionOpenings.add(opening);

    let handle: SessionAgentHandle;

    try {
      handle = await opening;
    } finally {
      this.sessionOpenings.delete(opening);
    }

    this.sessions.add(handle);

    return new RuntimeSessionInstance(handle);
  }

  investigate(options: InvestigateOptions): Promise<InvestigationResult> {
    this.assertRunning();

    const resolveSources = createSourceResolver(options.sources);

    const investigation = runInvestigation({
      model: this.options.model,
      apiKey: this.options.apiKey,
      systemPrompt:
        options.systemPrompt ??
        this.options.investigation?.systemPrompt ??
        this.options.systemPrompt,
      tools: this.options.investigation?.tools ?? [],
      sessionManager: this.options.sessionManager,
      investigationManager: this.options.investigationManager,
      memoryManager: this.options.memoryManager,
      sessionId: options.sessionId,
      target: options.target,
      memoryAccess: options.memoryAccess,
      crossSpace: options.crossSpace,
      resolveSources,
      question: options.question,
      signal: options.signal,
      onEvent: options.onEvent,
      onTitleUpdated: options.onTitleUpdated,
    });

    this.investigations.add(investigation);

    void investigation.then(
      () => this.investigations.delete(investigation),
      () => this.investigations.delete(investigation),
    );

    return investigation;
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeResources();

    return this.closePromise;
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  private async startResources() {
    if (this.currentStatus !== 'closing') {
      this.currentStatus = 'running';
    }
  }

  private async closeResources() {
    if (this.currentStatus === 'closed') {
      return;
    }

    // 先阻止新操作；即使启动失败，关闭仍需完成并进入终态。
    const starting = this.startPromise;
    this.currentStatus = 'closing';

    if (starting) {
      await Promise.allSettled([starting]);
      this.currentStatus = 'closing';
    }

    const openingResults = await Promise.allSettled(this.sessionOpenings);

    const activeResults = await Promise.allSettled([
      ...[...this.sessions].map(session => session.close()),
      ...this.investigations,
    ]);

    this.currentStatus = 'closed';

    const failures = [...openingResults, ...activeResults]
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason);

    if (failures.length) {
      throw new AggregateError(failures, 'Runtime 关闭时发生错误');
    }
  }

  private assertRunning() {
    if (this.closePromise || this.currentStatus !== 'running') {
      throw new Error(`Runtime 当前不可用：${this.currentStatus}`);
    }
  }

  private removeSession(session: SessionAgentHandle) {
    this.sessions.delete(session);
  }
}
