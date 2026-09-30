import { DEFAULT_SESSION_SUMMARY_SYSTEM_PROMPT, type SessionSummarizer } from '@cieljs/session';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';
import { completeSimple } from '@earendil-works/pi-ai/compat';

// 摘要是独立于对话输出的请求预算，与触发压缩的 reserveTokens 无关。
const SUMMARY_MAX_TOKENS = 2_048;

function renderContentBlock(block: unknown) {
  if (!block || typeof block !== 'object') {
    return block;
  }

  const value = block as Record<string, unknown>;

  // 图片以 base64 进入上下文；摘要只需要知道这个位置有一张图。
  if (value.type === 'image') {
    return { type: 'image', mimeType: value.mimeType };
  }

  return value;
}

function renderMessage(message: AgentMessage) {
  const value = message as { role?: unknown; content?: unknown };

  if (typeof value.content === 'string') {
    return { role: value.role, content: value.content };
  }

  if (Array.isArray(value.content)) {
    return { role: value.role, content: value.content.map(renderContentBlock) };
  }

  return message;
}

/** 摘要复用对话模型：上下文窗口最大，也不需要第二套模型配置。 */
export function createSessionSummarizer(model: Model<Api>, apiKey?: string): SessionSummarizer {
  return async ({ summary, messages, signal }) => {
    const response = await completeSimple(
      model,
      {
        systemPrompt: DEFAULT_SESSION_SUMMARY_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: JSON.stringify({ summary, messages: messages.map(renderMessage) }),
            timestamp: Date.now(),
          },
        ],
      },
      { apiKey, signal, maxTokens: SUMMARY_MAX_TOKENS },
    );

    if (response.stopReason !== 'stop') {
      throw new Error(response.errorMessage ?? `摘要未完整生成：${response.stopReason}`);
    }

    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim();

    // 空摘要会清掉全部旧上下文，不能写回。
    if (!text) {
      throw new Error('摘要模型返回了空内容');
    }

    return text;
  };
}
