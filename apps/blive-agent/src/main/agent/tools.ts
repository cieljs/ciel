import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import { defineTool } from 'cieljs/agent-kit';
import { Type, type Static } from 'typebox';

import type { DanmakuDelivery, RoomInfo, WatchEvent } from '../../shared/types.ts';
import type { LivePage } from '../bilibili/live-page.ts';

export type DanmakuToolResult =
  | { status: 'deferred'; reason: string }
  | { status: 'simulated'; content: string }
  | { status: 'submitted'; content: string; roomId: number };

export interface DanmakuToolContext {
  delivery: () => DanmakuDelivery;
  livePage: LivePage;
  room: () => RoomInfo | undefined;
  sentDanmaku: () => readonly string[];
  canSend: () => boolean;
  emit: (event: WatchEvent) => void;
}

export class DanmakuRunGate {
  private lastSentAt = -Infinity;

  async send<T>(action: () => Promise<T>): Promise<T> {
    const remaining = 1_000 - (Date.now() - this.lastSentAt);

    if (remaining > 0) {
      await new Promise(resolve => setTimeout(resolve, remaining));
    }

    try {
      return await action();
    } finally {
      this.lastSentAt = Date.now();
    }
  }
}

const SendDanmakuSchema = Type.Object({
  action: Type.Union([Type.Literal('send'), Type.Literal('defer')]),
  content: Type.String({ maxLength: 40 }),
  reason: Type.String({ minLength: 1 }),
});

export const createDanmakuTool = defineTool(
  SendDanmakuSchema,
  (context: DanmakuToolContext, gate: DanmakuRunGate) => ({
    name: 'send_danmaku',
    label: '发送弹幕',
    description: '选择发送一条自然弹幕或暂缓互动；同一轮可以多次调用，发送间隔至少约 1 秒。',
    executionMode: 'sequential',
    execute: params => executeDanmaku(params, context, gate),
  }),
);

async function executeDanmaku(
  params: Static<typeof SendDanmakuSchema>,
  context: DanmakuToolContext,
  gate: DanmakuRunGate,
) {
  if (params.action === 'defer') {
    context.emit({ type: 'danmaku_deferred', reason: params.reason });

    return toolResult({ status: 'deferred', reason: params.reason });
  }

  const { room, content } = prepareDanmaku(context, params.content);

  return toolResult(await gate.send(() => deliverDanmaku(context, room, content)));
}

async function deliverDanmaku(context: DanmakuToolContext, room: RoomInfo, content: string) {
  if (context.delivery() === 'simulate') {
    context.emit({ type: 'danmaku_simulated', content });

    return { status: 'simulated' as const, content };
  }

  const pageResult = await context.livePage.sendDanmaku(content);

  if (!pageResult.accepted) {
    const reason = pageResult.message || String(pageResult.code);
    const prefix = pageResult.riskControl ? '发送弹幕被风控拦截' : '页面拒绝发送弹幕';

    throw new Error(`${prefix}：${reason}`);
  }

  context.emit({ type: 'danmaku_submitted', content, roomId: room.roomId });

  return { status: 'submitted' as const, content, roomId: room.roomId };
}

/** 校验当前访问的发送权限和历史，模拟与真实发送共用同一套约束。 */
function prepareDanmaku(context: DanmakuToolContext, input: string) {
  if (!context.canSend()) {
    throw new Error('当前运行阶段不允许发送弹幕');
  }

  const room = context.room();

  if (!room) {
    throw new Error('当前尚未进入直播间');
  }

  const content = input.trim();

  if (!content) {
    throw new Error('弹幕不能为空');
  }

  const normalized = normalizeDanmaku(content);
  const isDuplicate = context.sentDanmaku().some(item => normalizeDanmaku(item) === normalized);

  if (isDuplicate) {
    throw new Error('不能重复发送当前访问中已经发过的弹幕');
  }

  return { room, content };
}

function toolResult(details: DanmakuToolResult): AgentToolResult<DanmakuToolResult> {
  return {
    content: [{ type: 'text', text: JSON.stringify(details) }],
    details,
  };
}

function normalizeDanmaku(content: string): string {
  return content.toLocaleLowerCase('zh-CN').replace(/[\s\p{P}\p{S}]+/gu, '');
}
