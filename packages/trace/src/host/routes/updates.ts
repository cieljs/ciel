import { os, ORPCError } from '@orpc/server';

import type { TraceUpdate, TraceEntry } from '../../protocol/index.ts';
import type { TraceHost } from '../host.ts';
import type { TraceRouterOptions } from '../router.ts';

export function createUpdatesProcedure(host: TraceHost, options: TraceRouterOptions = {}) {
  return os.handler(({ signal }) => subscribeUpdates(host, options, signal));
}

/** 先订阅再读快照，读取期间到达的变更留在队列中，避免初始化丢事件。 */
async function* subscribeUpdates(
  host: TraceHost,
  options: TraceRouterOptions,
  requestSignal?: AbortSignal,
): AsyncGenerator<TraceUpdate> {
  // 宿主关闭与客户端取消都必须唤醒等待中的订阅。
  const signal = requestSignal ? AbortSignal.any([requestSignal, host.signal]) : host.signal;

  if (signal.aborted) {
    return;
  }

  let wake: (() => void) | undefined;
  let dirty = false;
  const changed = new Map<string, TraceEntry>();
  const steps = new Map<string, TraceEntry>();

  const notify = (update: TraceUpdate) => {
    for (const entry of update.entries) {
      if (options.session?.(entry.sessionId) ?? true) {
        changed.set(entry.id, entry);
      }
    }

    for (const step of update.steps) {
      if (options.session?.(step.sessionId) ?? true) {
        steps.set(step.id, step);
      }
    }

    dirty = true;
    wake?.();
  };

  const unsubscribe = host.subscribe(notify);
  const abort = () => wake?.();
  signal.addEventListener('abort', abort);

  try {
    checkHealth(host);
    const initial = host.usage();
    let sent = JSON.stringify(initial);
    const initialEntries = await host.store.list<TraceEntry>('entry', { limit: 300 });
    const initialSteps = await host.store.list<TraceEntry>('step', { limit: 300 });

    yield {
      entries: initialEntries.filter(entry => options.session?.(entry.sessionId) ?? true),
      steps: initialSteps.filter(step => options.session?.(step.sessionId) ?? true),
      usage: initial,
      sessions: visibleSessions(host, options),
    };

    while (!signal.aborted) {
      checkHealth(host);

      const pending = new Promise<void>(resolve => {
        wake = resolve;
      });

      if (dirty) {
        dirty = false;
        const entries = [...changed.values()];
        changed.clear();
        const stepEntries = [...steps.values()];
        steps.clear();
        // 用量随每次推送重新取快照：宿主已合并完整历史，客户端不必自己累加。
        // 只靠用量变化也要推送：后台重放结束后没有新条目，但累计值已经变了。
        const usage = host.usage();
        const current = JSON.stringify(usage);

        if (entries.length || stepEntries.length || current !== sent) {
          sent = current;
          yield { entries, steps: stepEntries, usage, sessions: visibleSessions(host, options) };
        }
      } else {
        await pending;
      }
    }
  } finally {
    unsubscribe();
    signal.removeEventListener('abort', abort);
  }
}

function visibleSessions(host: TraceHost, options: TraceRouterOptions) {
  return host.sessions().filter(session => options.session?.(session.id) ?? true);
}

function checkHealth(host: TraceHost) {
  try {
    host.assertHealthy();
  } catch (cause) {
    throw new ORPCError('INTERNAL_SERVER_ERROR', {
      message: cause instanceof Error ? cause.message : 'Trace 事件处理失败',
      cause,
    });
  }
}
