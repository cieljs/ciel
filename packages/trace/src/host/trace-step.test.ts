import type { RuntimeEvent } from '@cieljs/agent-kit/protocol';
import { expect, it } from 'vite-plus/test';

import { createTraceStep } from './trace-step.ts';

function step(event: RuntimeEvent) {
  return createTraceStep({
    version: 1,
    id: 'event',
    sequence: 1,
    sessionId: 'session',
    runId: 'run',
    timestamp: 10,
    metadata: {},
    event,
  });
}

const failure = {
  role: 'assistant' as const,
  api: 'openai-completions' as const,
  provider: 'test',
  model: 'test',
  content: [],
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'error' as const,
  errorMessage: '模型请求失败',
  timestamp: 10,
};

it('运行开始保持进行中，结束才记录完成时间', () => {
  expect(step({ type: 'agent_start' })).toMatchObject({ status: 'running', endedAt: undefined });

  expect(step({ type: 'agent_end', messages: [] })).toMatchObject({
    status: 'completed',
    endedAt: 10,
  });
});

it('模型错误标记消息、轮次和运行，详情引用完整错误载荷', () => {
  expect(step({ type: 'message_end', message: failure })).toMatchObject({
    status: 'error',
    error: { id: 'event', path: ['event', 'message'] },
  });

  expect(step({ type: 'turn_end', message: failure, toolResults: [] })).toMatchObject({
    status: 'error',
    error: { path: ['event', 'message'] },
  });

  expect(step({ type: 'agent_end', messages: [failure] })).toMatchObject({
    status: 'error',
    error: { path: ['event', 'messages'] },
  });
});

it('会话压缩生成可读的轨迹步骤，摘要进入消息内容', () => {
  expect(
    step({ type: 'session_compaction', summary: '累计摘要', throughSeq: 3, createdAt: 10 }),
  ).toMatchObject({
    name: 'session_compaction',
    kind: 'event',
    label: '上下文压缩',
    text: '累计摘要',
    status: 'completed',
  });
});

it('工具失败及其结果消息均保留错误状态', () => {
  expect(
    step({
      type: 'tool_execution_end',
      toolCallId: 'call',
      toolName: 'search',
      result: { reason: '超时' },
      isError: true,
    }),
  ).toMatchObject({
    status: 'error',
    error: { path: ['event', 'result'] },
  });

  const message = {
    role: 'toolResult' as const,
    toolCallId: 'call',
    toolName: 'search',
    content: [],
    isError: true,
    timestamp: 10,
  };

  expect(step({ type: 'message_end', message })).toMatchObject({
    status: 'error',
    error: { path: ['event', 'message'] },
  });
});
