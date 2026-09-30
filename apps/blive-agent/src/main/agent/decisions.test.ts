import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';
import { describe, expect, it, vi } from 'vite-plus/test';

import {
  parseDecision,
  readRoomDecision,
  RoomDecisionSchema,
  RoomSelectionSchema,
} from './decisions.ts';

function answer(value: unknown): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: JSON.stringify(value) }],
    api: 'openai-completions',
    provider: 'test',
    model: 'test',
    stopReason: 'stop',
    timestamp: 0,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

it('缺少 reason 和 score 时仅纠正一次，禁用工具并恢复原工具', async () => {
  const incomplete = {
    action: 'explore',
    confidence: 0.9,
    danmakuAction: 'defer',
    evidence: ['内容重复'],
  };

  const complete = { ...incomplete, reason: '希望看看其他内容', score: 30 };
  const execute = vi.fn();

  const tools: AgentTool[] = [
    {
      name: 'send_danmaku',
      label: '弹幕',
      description: '发送',
      parameters: Type.Object({}),
      execute,
    },
  ];

  const state = { messages: [answer(incomplete)], tools };

  const prompt = vi.fn(async (text: string) => {
    expect(text).toContain('reason');
    expect(text).toContain('score');
    expect(state.tools).toEqual([]);
    state.messages.push(answer(complete));
  });

  await expect(readRoomDecision({ state, prompt }, new AbortController().signal)).resolves.toEqual(
    complete,
  );

  expect(prompt).toHaveBeenCalledOnce();
  expect(execute).not.toHaveBeenCalled();
  expect(state.tools).toBe(tools);
});

it('纠正仍缺字段时拒绝决策，不循环重试或伪造分数', async () => {
  const state = { messages: [answer({ action: 'explore' })], tools: [] };

  const prompt = vi.fn(async () => {
    state.messages.push(answer({ action: 'explore' }));
  });

  await expect(readRoomDecision({ state, prompt }, new AbortController().signal)).rejects.toThrow(
    '字段校验失败',
  );

  expect(prompt).toHaveBeenCalledOnce();
});

it('纠正请求失败时恢复工具，取消后不再请求模型', async () => {
  const state = { messages: [answer({})], tools: [] };
  const tools = state.tools;

  const prompt = vi.fn(async () => {
    throw new Error('模型不可用');
  });

  await expect(readRoomDecision({ state, prompt }, new AbortController().signal)).rejects.toThrow(
    '模型不可用',
  );

  expect(state.tools).toBe(tools);
  const controller = new AbortController();
  controller.abort();
  await expect(readRoomDecision({ state, prompt }, controller.signal)).rejects.toThrow();
  expect(prompt).toHaveBeenCalledOnce();
});

describe('parseDecision', () => {
  it('接受代码围栏包裹的合法 JSON', () => {
    const decision = parseDecision(
      '```json\n{"action":"stay","confidence":0.8,"danmakuAction":"defer","evidence":[],"reason":"继续观察","score":60}\n```',
      RoomDecisionSchema,
    );

    expect(decision.score).toBe(60);
  });

  it('拒绝越界评分', () => {
    expect(() =>
      parseDecision(
        '{"action":"stay","confidence":0.8,"danmakuAction":"defer","evidence":[],"reason":"继续观察","score":101}',
        RoomDecisionSchema,
      ),
    ).toThrow('Agent 决策字段校验失败');
  });
});

it('理由不设长度上限，长理由不拖垮选房与房间决策', () => {
  const reason = '主播正在讲的内容和当前分区不一致。'.repeat(20);
  const selection = { roomId: 22650610, reason };

  const decision = {
    action: 'explore',
    confidence: 0.9,
    danmakuAction: 'defer',
    evidence: ['主播在解释为什么换游戏'],
    reason,
    score: 30,
  };

  expect(parseDecision(JSON.stringify(selection), RoomSelectionSchema)).toEqual(selection);
  expect(parseDecision(JSON.stringify(decision), RoomDecisionSchema)).toEqual(decision);
});

it('接受分析文字后的裸选房 JSON，并保留理由中的括号和转义', () => {
  const selection = { roomId: 22650610, reason: '庆典 {互动} 与 "新衣"' };

  expect(
    parseDecision(`Based on my analysis.\n${JSON.stringify(selection)}`, RoomSelectionSchema),
  ).toEqual(selection);
});

it('拒绝裸 JSON 的多个选择与不完整输出', () => {
  expect(() => parseDecision('分析 {} {}', RoomSelectionSchema)).toThrow('多个决策 JSON');

  expect(() => parseDecision('分析 {"roomId":', RoomSelectionSchema)).toThrow(
    '不是有效的决策 JSON',
  );
});

it('接受分析文字后唯一的 JSON 代码块', () => {
  const text =
    '当前空间没有历史记录。\n分析：选择聊天直播。\n```json\n{"action":"stay","confidence":0.8,"danmakuAction":"defer","evidence":[],"reason":"继续观察","score":60}\n```';

  expect(parseDecision(text, RoomDecisionSchema).score).toBe(60);
});

it('拒绝存在多个候选决策的回复', () => {
  expect(() => parseDecision('```json\n{}\n```\n```json\n{}\n```', RoomDecisionSchema)).toThrow(
    '多个决策',
  );
});
