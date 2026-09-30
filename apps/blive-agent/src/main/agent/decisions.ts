import type { AgentMessage, AgentState } from '@earendil-works/pi-agent-core';
import { Type, type Static, type TSchema } from 'typebox';
import { Value } from 'typebox/value';

export const RoomSelectionSchema = Type.Object({
  roomId: Type.Integer({ minimum: 1 }),
  reason: Type.String({ minLength: 1 }),
});

export const RoomDecisionSchema = Type.Object({
  action: Type.Union([Type.Literal('stay'), Type.Literal('explore')]),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  danmakuAction: Type.Union([Type.Literal('send'), Type.Literal('defer')]),
  evidence: Type.Array(Type.String(), { maxItems: 5 }),
  reason: Type.String({ minLength: 1 }),
  score: Type.Number({ minimum: 0, maximum: 100 }),
});

export type RoomSelection = Static<typeof RoomSelectionSchema>;
export type RoomDecision = Static<typeof RoomDecisionSchema>;

export async function readRoomDecision(
  agent: {
    state: Pick<AgentState, 'messages' | 'tools'>;
    prompt: (text: string) => Promise<void>;
  },
  signal: AbortSignal,
): Promise<RoomDecision | undefined> {
  const answer = agent.state.messages.findLast(message => message.role === 'assistant');

  if (!answer) {
    return;
  }

  try {
    return parseDecision(messageText(answer), RoomDecisionSchema);
  } catch (error) {
    signal.throwIfAborted();
    const tools = agent.state.tools;
    // 纠正只补充本轮决策，不能再次发送弹幕或执行其他副作用。
    agent.state.tools = [];

    try {
      await agent.prompt(`上一条房间决策未通过校验：${String(error)}
请仅依据本轮已有观察与工具结果重新输出一个完整 JSON，不调用工具，不重复互动，不编造证据。
所有字段都必须提供，尤其不能遗漏 reason 和 score；score 是真实的继续观看兴趣，不能为了通过校验随意补值。
JSON Schema：${JSON.stringify(RoomDecisionSchema)}`);
    } finally {
      agent.state.tools = tools;
    }

    signal.throwIfAborted();
    const corrected = agent.state.messages.findLast(message => message.role === 'assistant');

    if (!corrected || corrected === answer) {
      throw error;
    }

    return parseDecision(messageText(corrected), RoomDecisionSchema);
  }
}

export function parseDecision<T extends TSchema>(text: string, schema: T): Static<T> {
  const normalized = text.trim();
  const blocks = [...normalized.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/giu)];

  if (blocks.length > 1) {
    throw new Error('Agent 输出包含多个决策 JSON，无法确定最终选择');
  }

  const content = blocks.length === 1 ? blocks[0]![1]!.trim() : decisionObject(normalized);
  let value: unknown;

  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new Error('Agent 输出不是有效的决策 JSON', { cause: error });
  }

  if (!Value.Check(schema, value)) {
    throw new Error(`Agent 决策字段校验失败：${JSON.stringify(Value.Errors(schema, value))}`);
  }

  return value;
}

/** 允许分析文字后的裸 JSON；按字符串和括号边界提取，不能贪婪拼接多个选择。 */
// oxlint-disable-next-line eslint/complexity -- JSON 边界扫描必须显式处理引号、转义和括号状态。
function decisionObject(text: string) {
  if (text.startsWith('{')) {
    return text;
  }

  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];

    if (start < 0) {
      if (character !== '{') {
        continue;
      }

      start = index;
    }

    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        quoted = false;
      }

      continue;
    }

    if (character === '"') {
      quoted = true;
    }

    if (character === '{') {
      depth++;
    }

    if (character !== '}') {
      continue;
    }

    depth--;

    if (depth !== 0) {
      continue;
    }

    objects.push(text.slice(start, index + 1));
    start = -1;
  }

  if (objects.length > 1) {
    throw new Error('Agent 输出包含多个决策 JSON，无法确定最终选择');
  }

  return objects.length === 1 && start < 0 ? objects[0]! : text;
}

export function messageText(message: AgentMessage): string {
  if (message.role !== 'assistant' && message.role !== 'user') {
    throw new Error(`无法从 ${message.role} 消息读取文本决策`);
  }

  if (typeof message.content === 'string') {
    return message.content;
  }

  return message.content
    .filter(item => item.type === 'text')
    .map(item => item.text)
    .join('');
}
