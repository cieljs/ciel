import type { TraceEntry } from '@cieljs/trace/protocol';

/** 一次工具调用的两处记录：执行摘要与 toolResult 消息，按 toolCallId 连接。 */
export interface ToolCallRecord {
  call?: TraceEntry;
  result?: TraceEntry;
}

/**
 * 按 toolCallId 连接工具执行摘要与 toolResult 消息。
 *
 * 流式期间 entries 每几十毫秒变一次，内容等价时复用同一个 Map：Map 实例变化会让
 * 所有消息卡片的 props 失效，触发整列表重渲染。
 */
export function indexToolCalls(
  entries: readonly TraceEntry[],
  previous?: ReadonlyMap<string, ToolCallRecord>,
): Map<string, ToolCallRecord> {
  const calls = new Map<string, ToolCallRecord>();

  for (const entry of entries) {
    const toolCallId = entry.toolCallId;

    if (!toolCallId) {
      continue;
    }

    const record = calls.get(toolCallId) ?? {};

    // 同一次调用的事件按 sequence 到达，后到的覆盖先到的，保留最新的修订。
    if (entry.kind === 'tool') {
      calls.set(toolCallId, { ...record, call: entry });
    } else if (entry.kind === 'message' && entry.name === 'toolResult') {
      calls.set(toolCallId, { ...record, result: entry });
    }
  }

  return sameCalls(previous, calls) ? (previous as Map<string, ToolCallRecord>) : calls;
}

/**
 * 对话列表只保留消息，并去掉已被工具块承接的 toolResult 卡片，避免同一次调用出现两处。
 *
 * 承接条件缺一不可：工具条目存在、它的 assistant 消息已知、该消息仍在当前窗口里。
 * 观察器中途挂接时工具条目没有 messageId，此时保留卡片，结果不会消失。
 */
export function conversationEntries(
  entries: readonly TraceEntry[],
  calls: ReadonlyMap<string, ToolCallRecord>,
): TraceEntry[] {
  const ids = new Set(entries.map(entry => entry.id));

  return entries.filter(entry => {
    if (entry.kind !== 'message') {
      return false;
    }

    if (entry.name !== 'toolResult' || !entry.toolCallId) {
      return true;
    }

    const messageId = calls.get(entry.toolCallId)?.call?.messageId;

    return !messageId || !ids.has(messageId);
  });
}

/** 工具条目优先；只有 toolResult 消息时视为执行完成。 */
export function toolCallStatus(record?: ToolCallRecord): 'running' | 'completed' | 'error' {
  if (record?.call) {
    return record.call.status;
  }

  return record?.result ? 'completed' : 'running';
}

/** 结果取值来源：优先带 output 引用的工具条目，其次 toolResult 消息。 */
export function toolResultEntry(record?: ToolCallRecord): TraceEntry | undefined {
  return record?.call?.output ? record.call : record?.result;
}

/**
 * 工具结果的展示载荷：`{ content, details }` 里 details 有内容时取 details（业务字段），
 * 否则取整个结果——执行失败时 details 为空对象，回落到含错误文本的 content。
 */
export function toolResultPayload(result: unknown): unknown {
  if (!result || typeof result !== 'object' || !('details' in result)) {
    return result;
  }

  const { details } = result as { details?: unknown };

  if (details === null || details === undefined) {
    return result;
  }

  if (typeof details === 'object' && !Object.keys(details).length) {
    return result;
  }

  return details;
}

/** 文本型工具结果：结果本身就是文本，或是 `{ content: [{ type: 'text', text }] }` 的消息形状。 */
export function toolResultText(result: unknown): string | undefined {
  if (typeof result === 'string') {
    return result.trim() || undefined;
  }

  if (!result || typeof result !== 'object' || !('content' in result)) {
    return undefined;
  }

  const { content } = result as { content?: unknown };

  if (!Array.isArray(content)) {
    return undefined;
  }

  const text = content
    .map(block => (block as { type?: string; text?: unknown }) ?? {})
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
    .trim();

  return text || undefined;
}

function sameCalls(
  previous: ReadonlyMap<string, ToolCallRecord> | undefined,
  next: ReadonlyMap<string, ToolCallRecord>,
) {
  if (!previous || previous.size !== next.size) {
    return false;
  }

  for (const [id, record] of next) {
    const before = previous.get(id);

    if (!before || before.call !== record.call || before.result !== record.result) {
      return false;
    }
  }

  return true;
}
