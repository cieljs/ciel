import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { SessionContext } from './types.ts';

export interface ContextTokenEstimate {
  tokens: number;
  usageTokens: number;
  trailingTokens: number;
  lastUsageIndex: number | null;
}

/** 参考 Pi 0.84.4：文本按字符数 / 4 估算，图片按 1200 tokens 计入。 */
// oxlint-disable-next-line eslint/complexity -- 消息联合类型按内容块种类逐项估算。
export function estimateAgentMessageTokens(message: AgentMessage): number {
  // Pi 可通过模块扩展注册自定义消息，这里只读取影响上下文的已知字段。
  const value = message as {
    content?: unknown;
    summary?: unknown;
    command?: unknown;
    output?: unknown;
  };

  if (typeof value.summary === 'string') {
    return Math.ceil(value.summary.length / 4);
  }

  if (typeof value.command === 'string' && typeof value.output === 'string') {
    return Math.ceil((value.command.length + value.output.length) / 4);
  }

  let chars = 0;

  if (typeof value.content === 'string') {
    return Math.ceil(value.content.length / 4);
  }

  if (!Array.isArray(value.content)) {
    return 0;
  }

  for (const entry of value.content) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const block = entry as Record<string, unknown>;

    if (block.type === 'text' && typeof block.text === 'string') {
      chars += block.text.length;
    } else if (block.type === 'image') {
      chars += 4800;
    } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
      chars += block.thinking.length;
    } else if (block.type === 'toolCall' && typeof block.name === 'string') {
      chars += block.name.length + (JSON.stringify(block.arguments)?.length ?? 0);
    }
  }

  return Math.ceil(chars / 4);
}

/**
 * 参考 Pi：最近有效用量 + 此后的消息估算；没有用量时估算摘要及全部消息。
 * usageStartIndex 用于排除压缩前的用量，消息本身仍参与无用量时的估算。
 */
// oxlint-disable-next-line eslint/complexity -- 从后向前寻找有效 usage 时需显式跳过多种无效消息。
export function estimateContextTokens(
  context: SessionContext,
  usageStartIndex = 0,
): ContextTokenEstimate {
  const { messages, summary } = context;

  if (
    !Number.isSafeInteger(usageStartIndex) ||
    usageStartIndex < 0 ||
    usageStartIndex > messages.length
  ) {
    throw new TypeError('usageStartIndex 必须位于消息数组的边界内');
  }

  for (let index = messages.length - 1; index >= usageStartIndex; index--) {
    const message = messages[index]!;

    if (
      message.role !== 'assistant' ||
      message.stopReason === 'error' ||
      message.stopReason === 'aborted'
    ) {
      continue;
    }

    const usage = message.usage;

    const usageTokens =
      usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;

    if (!Number.isFinite(usageTokens) || usageTokens <= 0) {
      continue;
    }

    const trailingTokens = messages
      .slice(index + 1)
      .reduce((total, entry) => total + estimateAgentMessageTokens(entry), 0);

    // 有效 usage 已包含当时的历史和摘要，不再重复累加。
    return {
      tokens: usageTokens + trailingTokens,
      usageTokens,
      trailingTokens,
      lastUsageIndex: index,
    };
  }

  const trailingTokens = messages.reduce(
    (total, message) => total + estimateAgentMessageTokens(message),
    Math.ceil((summary?.length ?? 0) / 4),
  );

  return { tokens: trailingTokens, usageTokens: 0, trailingTokens, lastUsageIndex: null };
}
