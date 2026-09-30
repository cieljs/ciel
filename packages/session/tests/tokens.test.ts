import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { describe, expect, test } from 'vite-plus/test';

import { findCompactionBoundary } from '../src/compaction.ts';
import { estimateContextTokens, estimateAgentMessageTokens } from '../src/tokens.ts';

const user = (content: string): AgentMessage => ({ role: 'user', content, timestamp: 1 });

function assistant(totalTokens: number): Extract<AgentMessage, { role: 'assistant' }> {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'done' }],
    timestamp: 2,
    api: 'openai-completions',
    model: 'test',
    provider: 'test',
    stopReason: 'stop',
    usage: {
      totalTokens,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

describe('Pi 上下文 token 计算', () => {
  test('优先使用最近有效 usage，仅估算它之后的消息，不重复累计摘要', () => {
    expect(
      estimateContextTokens({
        summary: '此前的摘要',
        messages: [user('previous'), assistant(200), user('abcdefgh')],
      }),
    ).toEqual({
      tokens: 202,
      usageTokens: 200,
      trailingTokens: 2,
      lastUsageIndex: 1,
    });
  });

  test('totalTokens 为零时汇总输入、输出和缓存，不重复叠加 reasoning', () => {
    const message = assistant(0);

    Object.assign(message.usage, {
      input: 10,
      output: 20,
      cacheRead: 30,
      cacheWrite: 40,
      reasoning: 5,
    });

    expect(estimateContextTokens({ summary: null, messages: [message] }).tokens).toBe(100);
  });

  test('错误、取消和全零 usage 不能替代前一条有效用量', () => {
    const error = assistant(900);
    error.stopReason = 'error';
    const aborted = assistant(800);
    aborted.stopReason = 'aborted';

    expect(
      estimateContextTokens({
        summary: null,
        messages: [assistant(100), error, aborted, assistant(0)],
      }),
    ).toMatchObject({
      tokens: 103,
      usageTokens: 100,
      trailingTokens: 3,
      lastUsageIndex: 0,
    });
  });

  test('压缩前 usage 失效后，估算新摘要和所有保留消息', () => {
    expect(
      estimateContextTokens({ summary: 'abcdefgh', messages: [user('abcd'), assistant(10000)] }, 2),
    ).toEqual({
      tokens: 4,
      usageTokens: 0,
      trailingTokens: 4,
      lastUsageIndex: null,
    });
  });

  test('图片、thinking、工具参数计入估算，图片数据长度不影响固定额度', () => {
    expect(
      estimateAgentMessageTokens({
        role: 'user',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'image', data: 'base64', mimeType: 'image/png' },
        ],
        timestamp: 1,
      }),
    ).toBe(1202);

    const message = assistant(0);

    message.content = [
      { type: 'thinking', thinking: '12345678' },
      { type: 'toolCall', id: 'call', name: 'tool', arguments: { a: 1 } },
    ];

    expect(estimateAgentMessageTokens(message)).toBe(5);
  });

  test('严格超过窗口减预留值才触发，消息数量不决定压缩', () => {
    const options = {
      contextWindow: 100,
      reserveTokens: 20,
      keepRecentMessages: 1,
      summarize: async () => '摘要',
    };

    const context = { summary: null, messages: [user('a'.repeat(316)), user('abcd')] };
    expect(findCompactionBoundary(context, options)).toBe(0);
    context.messages[0] = user('a'.repeat(320));
    expect(findCompactionBoundary(context, options)).toBe(1);

    expect(
      findCompactionBoundary(
        { summary: null, messages: Array.from({ length: 50 }, () => user('a')) },
        options,
      ),
    ).toBe(0);
  });

  test('默认预留 16384，只有完整长轮次时仍不截断轮次', () => {
    const context = { summary: null, messages: [user('abcd'), assistant(3616), user('')] };
    const options = { contextWindow: 20000, keepRecentMessages: 1, summarize: async () => '摘要' };
    expect(findCompactionBoundary(context, options)).toBe(0);
    context.messages[1] = assistant(3617);
    expect(findCompactionBoundary(context, options)).toBe(2);

    expect(
      findCompactionBoundary(
        { summary: null, messages: [user('abcd'), assistant(90000)] },
        options,
      ),
    ).toBe(0);
  });
});
