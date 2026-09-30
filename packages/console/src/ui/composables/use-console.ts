import type { TraceClient } from '@cieljs/trace/client';
import type { TraceSession, TraceEntry } from '@cieljs/trace/protocol';
import { computed, onMounted, onUnmounted, shallowRef } from 'vue';

import { mergeTraceEntries } from '../utils/trace-entries.ts';
import { emptyUsage } from '../utils/usage.ts';

const VIEW_CAPACITY = 600;
const PAGE_SIZE = 100;

export function useConsole(client: TraceClient) {
  const entries = shallowRef<TraceEntry[]>([]);
  const steps = shallowRef<TraceEntry[]>([]);
  const sessions = shallowRef<TraceSession[]>([]);
  const selectedSessionId = shallowRef('');

  const selectedSession = computed(() =>
    sessions.value.find(session => session.id === selectedSessionId.value),
  );

  const usage = computed(() => selectedSession.value?.usage ?? emptyUsage());
  const error = shallowRef('');
  const connected = shallowRef(false);
  const hasOlder = shallowRef(true);
  const loadingOlder = shallowRef(false);
  let controller: AbortController | undefined;
  let historyController: AbortController | undefined;
  let replayController: AbortController | undefined;

  // Entry 和原始事件各有自己的序号，且每个 Session 的清空水位独立。
  const clearedEntrySequences = new Map<string, number>();
  const clearedStepSequences = new Map<string, number>();

  async function connect() {
    controller?.abort();

    const current = new AbortController();
    controller = current;
    connected.value = false;
    error.value = '';

    try {
      const updates = await client.updates(undefined, { signal: current.signal });

      for await (const incoming of updates) {
        if (current.signal.aborted) {
          break;
        }

        connected.value = true;
        sessions.value = incoming.sessions;

        if (!selectedSessionId.value && incoming.sessions.length) {
          await selectSession(incoming.sessions.at(-1)!.id);
        }

        const sessionId = selectedSessionId.value;

        if (!sessionId) {
          continue;
        }

        const clearedStepSequence = clearedStepSequences.get(sessionId) ?? 0;
        const clearedEntrySequence = clearedEntrySequences.get(sessionId) ?? 0;

        steps.value = mergeTraceEntries(
          steps.value,
          incoming.steps.filter(
            step => step.sessionId === sessionId && step.sequence > clearedStepSequence,
          ),
        );

        entries.value = mergeTraceEntries(
          entries.value,
          incoming.entries.filter(
            entry => entry.sessionId === sessionId && entry.sequence > clearedEntrySequence,
          ),
        ).slice(-VIEW_CAPACITY);
      }
    } catch (cause) {
      if (!current.signal.aborted) {
        error.value = String(cause);
      }
    } finally {
      // 旧连接结束时不能覆盖已经建立的新连接状态。
      if (controller === current) {
        connected.value = false;
      }
    }
  }

  async function older() {
    const sessionId = selectedSessionId.value;

    if (!sessionId || loadingOlder.value || !hasOlder.value) {
      return;
    }

    const current = new AbortController();
    historyController = current;
    loadingOlder.value = true;

    try {
      const incoming = await client.steps.list(
        { cursor: steps.value[0]?.sequence, limit: PAGE_SIZE, sessionId },
        { signal: current.signal },
      );

      if (current.signal.aborted) {
        return;
      }

      const clearedStepSequence = clearedStepSequences.get(sessionId) ?? 0;
      const visible = incoming.filter(step => step.sequence > clearedStepSequence);
      hasOlder.value = incoming.length === PAGE_SIZE && visible.length === incoming.length;
      steps.value = mergeTraceEntries(steps.value, visible);
    } catch (cause) {
      if (!current.signal.aborted) {
        error.value = String(cause);
      }
    } finally {
      if (historyController === current) {
        loadingOlder.value = false;
      }
    }
  }

  async function selectSession(sessionId: string) {
    if (!sessionId) {
      return;
    }

    selectedSessionId.value = sessionId;
    entries.value = [];
    steps.value = [];
    hasOlder.value = true;
    await replay();
  }

  async function replay() {
    const sessionId = selectedSessionId.value;

    if (!sessionId) {
      return;
    }

    replayController?.abort();
    historyController?.abort();

    const current = new AbortController();
    replayController = current;
    loadingOlder.value = true;
    error.value = '';

    try {
      const [sessionEntries, sessionSteps] = await Promise.all([
        client.entries.list({ limit: 300, sessionId }, { signal: current.signal }),
        client.steps.list({ limit: PAGE_SIZE, sessionId }, { signal: current.signal }),
      ]);

      if (current.signal.aborted || selectedSessionId.value !== sessionId) {
        return;
      }

      const clearedEntrySequence = clearedEntrySequences.get(sessionId) ?? 0;
      const clearedStepSequence = clearedStepSequences.get(sessionId) ?? 0;
      const visibleEntries = sessionEntries.filter(entry => entry.sequence > clearedEntrySequence);
      const visibleSteps = sessionSteps.filter(step => step.sequence > clearedStepSequence);

      // 回放期间实时推送仍可能抵达；与快照合并，不能用稍旧的查询结果覆盖新事件。
      entries.value = mergeTraceEntries(visibleEntries, entries.value).slice(-VIEW_CAPACITY);
      steps.value = mergeTraceEntries(visibleSteps, steps.value);

      hasOlder.value =
        sessionSteps.length === PAGE_SIZE && visibleSteps.length === sessionSteps.length;
    } catch (cause) {
      if (!current.signal.aborted) {
        error.value = String(cause);
      }
    } finally {
      if (replayController === current) {
        loadingOlder.value = false;
      }
    }
  }

  // 清空只隐藏已加载的记录；用量由宿主按存储累计，不跟着视图重置。
  function clear() {
    const sessionId = selectedSessionId.value;

    if (!sessionId) {
      return;
    }

    historyController?.abort();
    loadingOlder.value = false;

    clearedEntrySequences.set(
      sessionId,
      Math.max(
        clearedEntrySequences.get(sessionId) ?? 0,
        ...entries.value.map(entry => entry.sequence),
      ),
    );

    clearedStepSequences.set(
      sessionId,
      Math.max(clearedStepSequences.get(sessionId) ?? 0, ...steps.value.map(step => step.sequence)),
    );

    entries.value = [];
    steps.value = [];
    hasOlder.value = false;
  }

  onMounted(connect);

  onUnmounted(() => {
    controller?.abort();
    historyController?.abort();
    replayController?.abort();
  });

  return {
    steps,
    entries,
    sessions,
    selectedSession,
    selectedSessionId,
    usage,
    error,
    connected,
    hasOlder,
    loadingOlder,
    older,
    selectSession,
    replay,
    connect,
    clear,
  };
}
