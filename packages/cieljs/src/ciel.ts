import { Runtime } from '@cieljs/runtime';

import type { CielOptions, CielStatus, InvestigateOptions, OpenSessionOptions } from './types.ts';

export class Ciel implements AsyncDisposable {
  private currentStatus: CielStatus = 'idle';
  private startPromise: Promise<void> | undefined;
  private closePromise: Promise<void> | undefined;
  private runtime: Runtime | undefined;

  constructor(private readonly options: CielOptions) {}

  get status(): CielStatus {
    return this.currentStatus;
  }

  start(): Promise<void> {
    if (this.closePromise) {
      return Promise.reject(new Error('Ciel 已开始关闭'));
    }

    if (this.currentStatus === 'running') {
      return Promise.resolve();
    }

    if (this.currentStatus === 'starting' && this.startPromise) {
      return this.startPromise;
    }

    this.currentStatus = 'starting';
    this.startPromise = this.startResources();

    return this.startPromise;
  }

  session(options: OpenSessionOptions) {
    return this.requireRuntime().session(options);
  }

  investigate(options: InvestigateOptions) {
    return this.requireRuntime().investigate(options);
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeResources();

    return this.closePromise;
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  private async startResources(): Promise<void> {
    try {
      if (this.options.data.isClosed) {
        throw new Error('CielData 已关闭');
      }

      const runtime = new Runtime({
        model: this.options.model,
        apiKey: this.options.apiKey,
        systemPrompt: this.options.systemPrompt,
        tools: [...(this.options.tools ?? []), ...(this.options.mcp?.tools ?? [])],
        investigation: this.options.investigation,
        sessionManager: this.options.data.sessions,
        investigationManager: this.options.data.investigations,
        memoryManager: this.options.data.memories,
      });

      this.runtime = runtime;

      await runtime.start();

      if (this.currentStatus !== 'closing') {
        this.currentStatus = 'running';
      }
    } catch (error) {
      const cleanupResults = await Promise.allSettled([this.runtime?.close()]);

      const cleanupFailures = cleanupResults
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map(result => result.reason);

      this.runtime = undefined;
      this.startPromise = undefined;

      if (this.currentStatus !== 'closing') {
        this.currentStatus = 'idle';
      }

      if (cleanupFailures.length) {
        throw new SuppressedError(
          new AggregateError(cleanupFailures, 'Ciel 启动回滚失败'),
          error,
          'Ciel 启动失败且回滚时发生错误',
        );
      }

      throw error;
    }
  }

  private async closeResources(): Promise<void> {
    if (this.currentStatus === 'closed') {
      return;
    }

    const starting = this.startPromise;
    this.currentStatus = 'closing';

    if (starting) {
      await Promise.allSettled([starting]);
      this.currentStatus = 'closing';
    }

    // 数据层由 CielData 持有，可供下一个 Ciel 实例复用。
    const runtimeResults = await Promise.allSettled([this.runtime?.close()]);

    this.runtime = undefined;
    this.currentStatus = 'closed';

    const failures = runtimeResults
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason);

    if (failures.length) {
      throw new AggregateError(failures, 'Ciel 关闭时发生错误');
    }
  }

  private requireRuntime(): Runtime {
    if (!this.runtime || this.currentStatus !== 'running') {
      throw new Error(`Ciel 当前不可用：${this.currentStatus}`);
    }

    return this.runtime;
  }
}
