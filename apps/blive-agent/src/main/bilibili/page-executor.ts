import type { WebContents } from 'electron';
import type { Static, TSchema } from 'typebox';
import { Value } from 'typebox/value';

export interface ExecutePageOptions {
  action?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  generation?: number;
  currentGeneration?: () => number;
}

export async function executePage<T extends TSchema>(
  contents: WebContents,
  code: string,
  schema: T,
  options: ExecutePageOptions = {},
): Promise<Static<T>> {
  const action = options.action ?? '执行页面脚本';

  assertAvailable(contents, options, action);

  const source = `(async () => await (${code}))()`;
  const execution = contents.executeJavaScript(source);
  const value = await withCancellation(execution, options, action);

  assertAvailable(contents, options, action);

  try {
    return Value.Parse(schema, value);
  } catch (error) {
    throw new Error(`${action}返回值未通过校验`, { cause: error });
  }
}

function assertAvailable(
  contents: Pick<WebContents, 'isDestroyed' | 'getURL'>,
  options: ExecutePageOptions,
  action: string,
): void {
  if (contents.isDestroyed()) {
    throw new Error(`${action}失败：直播页面已经销毁`);
  }

  if (options.signal?.aborted) {
    throw options.signal.reason ?? new Error(`${action}已取消`);
  }

  if (options.generation !== undefined && options.currentGeneration?.() !== options.generation) {
    throw new Error(`${action}失败：直播页面已切换`);
  }

  if (!isAllowedPageUrl(contents.getURL())) {
    throw new Error(`${action}失败：页面地址不在允许范围内`);
  }
}

async function withCancellation<T>(
  execution: Promise<T>,
  options: ExecutePageOptions,
  action: string,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  if (signal.aborted) {
    throw signal.reason;
  }

  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(new Error(`${action}在 ${timeoutMs}ms 内未完成`, { cause: signal.reason }));

    signal.addEventListener('abort', abort, { once: true });
    void execution.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function isAllowedPageUrl(value: string): boolean {
  if (value === '' || value === 'about:blank') {
    return true;
  }

  try {
    const url = new URL(value);

    return url.protocol === 'https:' && isBilibiliHost(url.hostname);
  } catch {
    return false;
  }
}

function isBilibiliHost(hostname: string): boolean {
  return hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com');
}
