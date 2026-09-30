import type { TraceClient } from '@cieljs/trace/client';
import type { TraceEntry } from '@cieljs/trace/protocol';
import { shallowRef, watch } from 'vue';

export type TraceSection = 'input' | 'output' | 'raw' | 'error' | 'schema';
const READ_TIMEOUT_MS = 5_000;

function readValue(
  client: TraceClient,
  reference: NonNullable<TraceEntry['output']>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const request = new AbortController();
  const abort = () => request.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => request.abort(new Error('读取内容超时')), READ_TIMEOUT_MS);

  const cancelled = new Promise<never>((_resolve, reject) => {
    request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
  });

  return Promise.race([
    client.values.get(reference, { signal: request.signal }),
    cancelled,
  ]).finally(() => {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  });
}

/** 仅加载当前查看的内容；切换记录或版本时取消旧请求，避免旧响应覆盖新选择。 */
export function useTraceValue(
  client: () => TraceClient | undefined,
  entry: () => TraceEntry | undefined,
  section: () => TraceSection | undefined,
) {
  const value = shallowRef<unknown>();
  const error = shallowRef('');
  const loading = shallowRef(false);

  watch(
    () => {
      const key = section();

      return [client(), entry()?.id, entry()?.revision, key, key && entry()?.[key]?.id] as const;
    },
    // oxlint-disable-next-line eslint/complexity -- watcher 在同一取消域内处理选择切换、请求和清理。
    async ([nextClient, nextId, , nextSection], previous, onCleanup) => {
      const controller = new AbortController();
      onCleanup(() => controller.abort());

      // 同一条流式消息更新时保留旧内容；换记录或标签时才清空，避免闪烁。
      const selectionChanged =
        nextClient !== previous?.[0] || nextId !== previous?.[1] || nextSection !== previous?.[3];

      if (selectionChanged) {
        value.value = undefined;
      }

      error.value = '';
      loading.value = false;

      const target = entry();
      const key = section();

      if (!nextClient || !target || !key) {
        return;
      }

      const reference = target[key];

      if (!reference) {
        return;
      }

      loading.value = true;

      try {
        let result: unknown;

        try {
          result = await readValue(nextClient, reference, controller.signal);
        } catch (cause) {
          if (!(cause instanceof Error && cause.message === '读取内容超时')) {
            throw cause;
          }

          result = await readValue(nextClient, reference, controller.signal);
        }

        if (!controller.signal.aborted) {
          value.value = result;
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          error.value = String(cause);
        }
      } finally {
        if (!controller.signal.aborted) {
          loading.value = false;
        }
      }
    },
    { immediate: true },
  );

  return { value, error, loading };
}
