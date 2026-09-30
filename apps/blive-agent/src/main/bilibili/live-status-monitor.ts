export type LiveStatus = 'live' | 'offline' | null;

interface LiveStatusMonitorOptions {
  readStatus: (signal: AbortSignal, reason: 'periodic' | 'media_exit') => Promise<LiveStatus>;
  onOffline: () => void;
  onMediaFailure: (error: Error) => void;
  onError: (error: Error) => void;
  intervalMs?: number;
}

/** 一次房间访问独占一个监视器；串行检查，关闭后丢弃所有迟到的结果。 */
export class LiveStatusMonitor {
  private readonly controller = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  private checking = false;
  private mediaFailure?: Error;

  constructor(private readonly options: LiveStatusMonitorOptions) {}

  start() {
    void this.check();
  }

  mediaStopped(error?: Error) {
    // 正常 EOF 也意味着感知已停止，不能继续保持 watching。
    this.mediaFailure = error ?? new Error('直播媒体流已结束');
    void this.check();
  }

  close() {
    this.controller.abort();
    clearTimeout(this.timer);
  }

  // oxlint-disable-next-line eslint/complexity -- 状态检查集中处理页面、媒体与直播状态的互斥结果。
  private async check() {
    if (this.checking || this.controller.signal.aborted) {
      return;
    }

    this.checking = true;
    clearTimeout(this.timer);

    try {
      const hadMediaFailure = Boolean(this.mediaFailure);
      const reason = hadMediaFailure ? 'media_exit' : 'periodic';
      let status = await this.options.readStatus(this.controller.signal, reason);

      // 退出通知可能在页面查询期间到达；此时补一次 API 核实，不能信任旧的播放状态。
      const needsMediaVerification = this.mediaFailure && !hadMediaFailure;

      if (!this.controller.signal.aborted && needsMediaVerification) {
        status = await this.options.readStatus(this.controller.signal, 'media_exit');
      }

      if (this.controller.signal.aborted) {
        return;
      }

      if (status === 'offline') {
        this.close();
        this.options.onOffline();

        return;
      }

      if (this.mediaFailure) {
        this.close();
        this.options.onMediaFailure(this.mediaFailure);
      }
    } catch (cause) {
      if (this.controller.signal.aborted) {
        return;
      }

      const error = cause instanceof Error ? cause : new Error(String(cause));

      if (this.mediaFailure) {
        this.close();
        this.options.onMediaFailure(new Error('媒体已退出，且无法确认直播状态', { cause: error }));
      } else {
        // 查询失败不能当作下播；保留访问并在下一次检查重试。
        this.options.onError(error);
      }
    } finally {
      this.checking = false;

      if (!this.controller.signal.aborted) {
        this.timer = setTimeout(() => void this.check(), this.options.intervalMs ?? 5_000);
      }
    }
  }
}
