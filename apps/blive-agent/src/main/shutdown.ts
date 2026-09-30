export class ShutdownCoordinator {
  private readonly resources = new Set<() => Promise<void>>();
  private closing?: Promise<void>;
  private completed = false;

  get isComplete() {
    return this.completed;
  }

  register(close: () => Promise<void>) {
    if (this.closing) {
      throw new Error('应用正在关闭，不能再注册资源');
    }

    this.resources.add(close);

    return () => {
      this.resources.delete(close);
    };
  }

  close(): Promise<void> {
    this.closing ??= this.closeResources();

    return this.closing;
  }

  private async closeResources() {
    const results = await Promise.allSettled([...this.resources].map(close => close()));

    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason);

    if (failures.length === 1) {
      throw failures[0];
    }

    if (failures.length > 1) {
      throw new AggregateError(failures, '关闭应用资源失败');
    }

    this.completed = true;
  }
}
