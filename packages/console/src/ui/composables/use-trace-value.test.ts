import type { TraceClient } from '@cieljs/trace/client';
import type { TraceEntry } from '@cieljs/trace/protocol';
import { expect, it, vi } from 'vite-plus/test';
import { effectScope, nextTick, shallowRef } from 'vue';

import { useTraceValue } from './use-trace-value.ts';

it('首次读取挂起时随修订重试，后续修订继续读取最新内容', async () => {
  const reference = { id: 'message:output', preview: '完整内容' };
  const entry = shallowRef({ id: 'message', revision: 1, output: reference } as TraceEntry);

  const get = vi
    .fn()
    .mockImplementationOnce(
      (_input, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), {
            once: true,
          });
        }),
    )
    .mockResolvedValueOnce({ content: '已读取' })
    .mockResolvedValueOnce({ content: '更新内容' });

  const client = { values: { get } } as unknown as TraceClient;
  const scope = effectScope();

  const state = scope.run(() =>
    useTraceValue(
      () => client,
      () => entry.value,
      () => 'output',
    ),
  )!;

  await nextTick();
  expect(get).toHaveBeenCalledTimes(1);

  entry.value = { ...entry.value, revision: 2 };
  await nextTick();
  expect(get).toHaveBeenCalledTimes(2);
  await vi.waitFor(() => expect(state.value.value).toEqual({ content: '已读取' }));

  entry.value = { ...entry.value, revision: 3 };
  await nextTick();
  expect(get).toHaveBeenCalledTimes(3);
  await vi.waitFor(() => expect(state.value.value).toEqual({ content: '更新内容' }));
  scope.stop();
});

it('首次请求超时后自动重试一次，不让消息永久停在读取中', async () => {
  vi.useFakeTimers();

  try {
    const entry = {
      id: 'message',
      revision: 1,
      output: { id: 'output', preview: '内容' },
    } as TraceEntry;

    const get = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue({ content: '重试成功' });

    const client = { values: { get } } as unknown as TraceClient;
    const scope = effectScope();

    const state = scope.run(() =>
      useTraceValue(
        () => client,
        () => entry,
        () => 'output',
      ),
    )!;

    await vi.advanceTimersByTimeAsync(5_000);
    expect(get).toHaveBeenCalledTimes(2);
    expect(state.value.value).toEqual({ content: '重试成功' });
    expect(state.loading.value).toBe(false);
    scope.stop();
  } finally {
    vi.useRealTimers();
  }
});
