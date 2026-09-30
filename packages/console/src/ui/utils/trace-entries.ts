import type { TraceEntry, ValueRef } from '@cieljs/trace/protocol';

/** 历史分页和实时推送可能重叠；按 ID 去重，并保留较新的修订。 */
export function mergeTraceEntries(current: TraceEntry[], incoming: TraceEntry[]) {
  const merged = new Map(current.map(entry => [entry.id, entry]));

  for (const entry of incoming) {
    const previous = merged.get(entry.id);

    if (previous && (previous.revision ?? 0) > (entry.revision ?? 0)) {
      continue;
    }

    merged.set(entry.id, entry);
  }

  return [...merged.values()].sort((a, b) => a.sequence - b.sequence);
}

export interface TraceStepGroup extends TraceEntry {
  events: ValueRef[];
  /** 组内最后一次事件的时刻。 */
  updatedAt: number;
  /** 未结束分组的耗时定格时刻：取所在 run 最后一次观察到的事件。 */
  runningUntil?: number;
}

/** 原始事件仍独立保存；列表按业务对象合并，Inspect 可逐个回读完整快照。 */
// oxlint-disable-next-line eslint/complexity -- 这是 Trace 事件到列表投影的单遍归并器，分支对应协议事件种类。
export function groupTraceSteps(steps: TraceEntry[]): TraceStepGroup[] {
  const records = new Map<string, TraceStepGroup>();

  for (const step of steps.toSorted((left, right) => left.sequence - right.sequence)) {
    const scope = step.runId ? `${step.sessionId}/${step.runId}` : step.sessionId;
    let key = step.id;
    let name = step.name;
    let kind = step.kind;
    const toolResult = step.kind === 'message' && step.label === 'toolResult';

    if ((step.kind === 'tool' || toolResult) && step.toolCallId) {
      key = `${scope}/tool/${step.toolCallId}`;
      name = 'tool_execution';
      kind = 'tool';
    } else if (step.kind === 'message' && step.messageId) {
      key = `${scope}/message/${step.messageId}`;
      name = 'message';
    } else if (/^agent_(start|end)$/.test(step.name) && step.runId) {
      key = `${scope}/agent`;
      name = 'agent';
    } else if (/^turn_(start|end)$/.test(step.name) && step.turnId) {
      key = `${scope}/turn/${step.turnId}`;
      name = 'turn';
    }

    const previous = records.get(key);
    const isRunning = step.name.endsWith('_start') || step.name.endsWith('_update');
    let status = step.status;

    if (isRunning) {
      status = 'running';
    }

    // toolResult 是结果入会话的事件，不重新开始工具，也不延长工具执行耗时。
    if (toolResult && previous) {
      status = previous.status;
    }

    if (previous?.status === 'error' || step.status === 'error') {
      status = 'error';
    }

    records.set(key, {
      ...step,
      id: key,
      kind,
      name,
      turnId: name === 'agent' ? undefined : step.turnId,
      label: toolResult ? (previous?.label ?? '工具结果') : (step.label ?? previous?.label),
      description: step.description ?? previous?.description,
      sequence: previous?.sequence ?? step.sequence,
      revision: step.revision ?? step.sequence,
      status,
      startedAt: previous?.startedAt ?? step.startedAt,
      updatedAt: Math.max(previous?.updatedAt ?? 0, step.endedAt ?? step.startedAt),
      endedAt: resolveEndedAt(status, toolResult, previous?.endedAt, step.endedAt),
      input: step.input ?? previous?.input,
      output: step.output ?? previous?.output,
      error: previous?.error ?? step.error,
      schema: step.schema ?? previous?.schema,
      text: step.text ?? previous?.text,
      thinking: step.thinking ?? previous?.thinking,
      turnNumber: step.turnNumber ?? previous?.turnNumber,
      events: [...(previous?.events ?? []), ...(step.raw ? [step.raw] : [])],
    });
  }

  const groups = [...records.values()];
  const runNumbers = new Map<string, Map<string, number>>();

  for (const group of groups) {
    // 一轮 = 一次 Agent 运行：同一 run 的所有分组共用先落的号，宿主没给号时才顺序补一个。
    const runId = group.runId;

    if (!runId) {
      continue;
    }

    const sessionKey = group.sessionId;
    let sessionRuns = runNumbers.get(sessionKey);

    if (!sessionRuns) {
      sessionRuns = new Map();
      runNumbers.set(sessionKey, sessionRuns);
    }

    if (!sessionRuns.has(runId)) {
      const lastTurn = Math.max(0, ...sessionRuns.values());
      sessionRuns.set(runId, group.turnNumber ?? lastTurn + 1);
    }

    group.turnNumber = sessionRuns.get(runId);
  }

  // 未结束分组的耗时定格在所在 run 最后一次观察到的事件上，而不是墙上时钟：
  // 被中断的 run 不再无限增长，仍在输出的 run 也会随新事件持续推进。
  const lastEventOfRun = new Map<string, number>();

  for (const group of groups) {
    const key = group.runId ?? group.id;
    lastEventOfRun.set(key, Math.max(lastEventOfRun.get(key) ?? 0, group.updatedAt));
  }

  for (const group of groups) {
    if (group.status === 'running') {
      group.runningUntil = lastEventOfRun.get(group.runId ?? group.id);
    }
  }

  return groups;
}

function resolveEndedAt(
  status: TraceEntry['status'],
  isToolResult: boolean,
  previousEndedAt: number | undefined,
  endedAt: number | undefined,
) {
  if (status === 'running') {
    return undefined;
  }

  if (isToolResult) {
    return previousEndedAt ?? endedAt;
  }

  return endedAt;
}

export function traceActor(entry: TraceEntry): 'Agent' | 'Tool' {
  return entry.kind === 'tool' ? 'Tool' : 'Agent';
}

export function traceStepLabel(entry: TraceEntry) {
  if (entry.name === 'agent') {
    return 'Agent 运行';
  }

  if (entry.name === 'turn') {
    return '模型轮次';
  }

  if (entry.kind === 'tool') {
    return entry.label ?? entry.name;
  }

  if (entry.kind === 'message') {
    if (entry.label === 'user') {
      return '输入消息';
    }

    if (entry.label === 'Ciel' || entry.label === 'assistant') {
      return 'Ciel 回复';
    }

    return entry.label ?? '消息';
  }

  return entry.label ?? entry.name;
}
