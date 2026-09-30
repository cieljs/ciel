interface PageWaitOptions {
  action: string;
  timeoutMs: number;
  intervalMs?: number;
  signal?: AbortSignal;
}

/** 串行轮询页面；独立超时计时器保证单次脚本挂起时也能结束等待。 */
export function waitForPage<T>(
  read: () => Promise<T | undefined>,
  { action, timeoutMs, intervalMs = 500, signal }: PageWaitOptions,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let finished = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const timeoutTimer = setTimeout(() => fail(new Error(`${action}超时`)), timeoutMs);

    function cleanup() {
      finished = true;
      clearTimeout(timeoutTimer);
      clearTimeout(pollTimer);
      signal?.removeEventListener('abort', abort);
    }

    function fail(error: unknown) {
      if (finished) {
        return;
      }

      cleanup();
      reject(error);
    }

    function abort() {
      fail(signal?.reason ?? new Error(`${action}已取消`));
    }

    async function poll() {
      try {
        const value = await read();

        if (finished) {
          return;
        }

        if (value !== undefined) {
          cleanup();
          resolve(value);

          return;
        }

        pollTimer = setTimeout(() => void poll(), intervalMs);
      } catch (error) {
        fail(error);
      }
    }

    signal?.addEventListener('abort', abort, { once: true });

    if (signal?.aborted) {
      abort();

      return;
    }

    void poll();
  });
}
