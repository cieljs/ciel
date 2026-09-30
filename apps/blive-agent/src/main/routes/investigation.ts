import { randomUUID } from 'node:crypto';

import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';
import { completeSimple } from '@earendil-works/pi-ai/compat';
import { os } from '@orpc/server';
import { Ciel, type CielData, type InvestigationTarget } from 'cieljs';
import type { McpTools } from 'cieljs/mcp';
import type { SessionInfo, SessionManager } from 'cieljs/session';
import type { Storage } from 'cieljs/storage';
import * as z from 'zod';

import type { RoomInfo } from '../../shared/types.ts';
import type { BilibiliApi } from '../bilibili/api.ts';
import { createRoomSources } from '../prompts/index.ts';

const targetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('global') }),
  z.object({ type: z.literal('room'), roomId: z.number().int().positive() }),
]);

const sessionInputSchema = z.object({ sessionId: z.string().trim().min(1) });

interface InvestigationConversationState {
  sessionId: string;
  inputTarget: z.infer<typeof targetSchema>;
  target: InvestigationTarget;
  sources: string[];
  title: string;
  label: string;
  createdAt: number;
  room?: RoomInfo;
}

const INVESTIGATION_SYSTEM_PROMPT = `你是 Ciel 的 Investigation Agent。你帮助用户分析直播间与跨直播间历史，也可以按用户要求管理当前调查目标的记忆。只有问题需要历史证据时才检索，已有足够证据就直接回答；同一问题不要反复改写关键词搜索。Bilibili 查询结果若值得保留，可以写入目标记忆；正文注明外部来源、可用链接和时间，不冒充亲历。新增或修改记忆前检查重复和现有版本，完成一次必要的写入后就回答，不要为确认写入而重复查询。区分事实、推断与未知。工具权限由宿主限定，不要尝试改变调查目标或扩大写入范围。`;
const TITLE_SYSTEM_PROMPT = `你负责为 Investigation 会话生成简短标题。根据用户的首个问题概括调查主题，只输出标题本身，不要引号、句号、Markdown 或解释。标题使用用户提问的语言，最多 24 个汉字或 48 个拉丁字符。`;

interface InvestigationUpdate {
  type: 'title_updated';
  sessionId: string;
  title: string;
}

export function createInvestigationRoutes(options: {
  storage: Storage;
  data: CielData;
  sessions: SessionManager;
  resolveModel: () => { model: Model<Api>; apiKey?: string };
  mcp?: McpTools;
  biliTools?: AgentTool[];
  api: BilibiliApi;
  current: () => { room?: RoomInfo; sessionId?: string };
}) {
  const conversations = new Map<string, InvestigationConversationState>();
  const active = new Map<string, AbortController>();
  const updateListeners = new Set<(update: InvestigationUpdate) => void>();
  const lifetime = new AbortController();
  let ciel: Ciel | undefined;
  let starting: Promise<Ciel> | undefined;

  const requireCiel = () => {
    starting ??= (async () => {
      const ai = options.resolveModel();

      const instance = new Ciel({
        model: ai.model,
        apiKey: ai.apiKey,
        data: options.data,
        systemPrompt: INVESTIGATION_SYSTEM_PROMPT,
        investigation: {
          systemPrompt: INVESTIGATION_SYSTEM_PROMPT,
          tools: [...(options.mcp?.tools ?? []), ...(options.biliTools ?? [])],
        },
      });

      await instance.start();
      ciel = instance;

      return instance;
    })();

    return starting;
  };

  const serializeConversation = (conversation: InvestigationConversationState) => ({
    sessionId: conversation.sessionId,
    target: conversation.inputTarget,
    title: conversation.title,
    label: conversation.label,
    createdAt: conversation.createdAt,
    room: conversation.room,
  });

  const publishTitle = (conversation: InvestigationConversationState) => {
    const update = {
      type: 'title_updated',
      sessionId: conversation.sessionId,
      title: conversation.title,
    } satisfies InvestigationUpdate;

    for (const listener of updateListeners) {
      listener(update);
    }
  };

  const generateTitle = async (question: string, signal: AbortSignal) => {
    const ai = options.resolveModel();

    const response = await completeSimple(
      ai.model,
      {
        systemPrompt: TITLE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: question, timestamp: Date.now() }],
      },
      { apiKey: ai.apiKey, signal, maxTokens: 64 },
    );

    if (response.stopReason !== 'stop') {
      throw new Error(response.errorMessage ?? `标题未完整生成：${response.stopReason}`);
    }

    return response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join(' ')
      .replace(/\s+/gu, ' ')
      .replace(/^["'“”‘’]+|["'“”‘’。]+$/gu, '')
      .trim()
      .slice(0, 48);
  };

  const updateGeneratedTitle = async (
    conversation: InvestigationConversationState,
    question: string,
    provisionalTitle: string,
    signal: AbortSignal,
  ) => {
    try {
      const generatedTitle = await generateTitle(question, signal);

      if (!generatedTitle || conversation.title !== provisionalTitle) {
        return;
      }

      await persistTitle(conversation.sessionId, generatedTitle);
      conversation.title = generatedTitle;
      publishTitle(conversation);
    } catch (error) {
      if (!signal.aborted) {
        console.warn('生成 Investigation 标题失败', error);
      }
    }
  };

  const restoreConversation = (session: Pick<SessionInfo, 'id' | 'title' | 'createdAt'>) => {
    const sessionId = session.id;
    const createdAt = session.createdAt.getTime();

    if (!sessionId.startsWith('investigation:')) {
      return;
    }

    const parts = sessionId.split(':');

    if (parts[1] === 'global') {
      return {
        sessionId,
        inputTarget: { type: 'global' } as const,
        target: { type: 'global' } as const,
        sources: ['application:blive-agent', 'investigation:global'],
        title: session.title ?? '全局调查',
        label: '全局调查',
        createdAt,
      } satisfies InvestigationConversationState;
    }

    const roomId = Number(parts[2]);

    if (parts[1] !== 'room' || !Number.isSafeInteger(roomId) || roomId <= 0) {
      return;
    }

    return {
      sessionId,
      inputTarget: { type: 'room', roomId } as const,
      target: { type: 'space', spaceId: `bilibili:room:${roomId}` } as const,
      sources: ['application:blive-agent', `bilibili:room:${roomId}`],
      title: session.title ?? `房间 ${roomId} 调查`,
      label: `房间 ${roomId}`,
      createdAt,
    } satisfies InvestigationConversationState;
  };

  const persistTitle = async (sessionId: string, title: string) => {
    const session = await options.sessions.getSessionAcrossSpaces(sessionId);

    if (!session) {
      throw new Error('Investigation Session 不存在');
    }

    await session.update({ title });
  };

  const requireConversation = async (sessionId: string) => {
    let conversation = conversations.get(sessionId);

    if (!conversation) {
      const session = await options.sessions.getSessionAcrossSpaces(sessionId);
      conversation = session ? restoreConversation(await session.getInfo()) : undefined;

      if (conversation) {
        conversations.set(sessionId, conversation);
      }
    }

    if (!conversation) {
      throw new Error('Investigation 会话不存在，请新建调查');
    }

    if (conversation.inputTarget.type === 'global' || conversation.room) {
      return conversation;
    }

    const room = await options.api.room(conversation.inputTarget.roomId);
    const current = options.current();

    conversation = {
      ...conversation,
      target: {
        type: 'space',
        spaceId: `bilibili:room:${room.roomId}`,
        sessionId: current.room?.roomId === room.roomId ? current.sessionId : undefined,
      },
      sources: createRoomSources(room),
      label: `${room.streamerName} · ${room.title}`,
      room,
    };

    conversations.set(sessionId, conversation);

    return conversation;
  };

  const list = os.handler(async () => {
    for (const session of await options.sessions.list()) {
      if (conversations.has(session.id)) {
        continue;
      }

      const conversation = restoreConversation(session);

      if (conversation) {
        conversations.set(session.id, conversation);
      }
    }

    return [...conversations.values()]
      .sort((left, right) => left.createdAt - right.createdAt)
      .map(serializeConversation);
  });

  const create = os.input(z.object({ target: targetSchema })).handler(async ({ input }) => {
    const sessionScope = input.target.type === 'global' ? 'global' : `room:${input.target.roomId}`;
    const sessionId = `investigation:${sessionScope}:${randomUUID()}`;
    const createdAt = Date.now();
    let conversation: InvestigationConversationState;

    if (input.target.type === 'global') {
      conversation = {
        sessionId,
        inputTarget: input.target,
        target: { type: 'global' },
        sources: ['application:blive-agent', 'investigation:global'],
        title: '新调查',
        label: '全局调查',
        createdAt,
      };
    } else {
      const room = await options.api.room(input.target.roomId);
      const current = options.current();
      const targetSessionId = current.room?.roomId === room.roomId ? current.sessionId : undefined;

      conversation = {
        sessionId,
        inputTarget: input.target,
        target: {
          type: 'space',
          spaceId: `bilibili:room:${room.roomId}`,
          sessionId: targetSessionId,
        },
        sources: createRoomSources(room),
        title: '新调查',
        label: `${room.streamerName} · ${room.title}`,
        createdAt,
        room,
      };
    }

    const spaceId = conversation.target.type === 'global' ? 'global' : conversation.target.spaceId;

    await options.sessions.space(spaceId).openSession({
      id: sessionId,
      title: conversation.title,
      sources: conversation.sources,
    });

    conversations.set(sessionId, conversation);

    return serializeConversation(conversation);
  });

  const rename = os
    .input(sessionInputSchema.extend({ title: z.string().trim().min(1).max(80) }))
    .handler(async ({ input }) => {
      const conversation = await requireConversation(input.sessionId);
      await persistTitle(conversation.sessionId, input.title);
      conversation.title = input.title;
      publishTitle(conversation);

      return serializeConversation(conversation);
    });

  const deleteConversation = os.input(sessionInputSchema).handler(async ({ input }) => {
    if (active.has(input.sessionId)) {
      throw new Error('Investigation 正在回答，请先停止回答');
    }

    const session = await options.sessions.getSessionAcrossSpaces(input.sessionId);

    if (!session || !input.sessionId.startsWith('investigation:')) {
      throw new Error('Investigation 会话不存在');
    }

    await session.delete();
    conversations.delete(input.sessionId);
  });

  const updates = os.handler(async function* ({ signal }) {
    const queue: InvestigationUpdate[] = [];
    let wake: (() => void) | undefined;

    const receive = (update: InvestigationUpdate) => {
      queue.push(update);
      wake?.();
    };

    const abort = () => wake?.();

    updateListeners.add(receive);
    signal?.addEventListener('abort', abort);
    lifetime.signal.addEventListener('abort', abort);

    try {
      while (!signal?.aborted && !lifetime.signal.aborted) {
        const pending = new Promise<void>(resolve => {
          wake = resolve;
        });

        if (queue.length) {
          yield queue.shift()!;
        } else {
          await pending;
        }
      }
    } finally {
      updateListeners.delete(receive);
      signal?.removeEventListener('abort', abort);
      lifetime.signal.removeEventListener('abort', abort);
    }
  });

  const prompt = os
    .input(sessionInputSchema.extend({ content: z.string().trim().min(1).max(32_000) }))
    .handler(async ({ input, signal }) => {
      const conversation = await requireConversation(input.sessionId);

      if (active.has(input.sessionId)) {
        throw new Error('Investigation 正在回答上一条消息');
      }

      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      active.set(input.sessionId, controller);

      let titleUpdate: Promise<void> | undefined;

      if (conversation.title === '新调查') {
        const provisionalTitle = input.content.replace(/\s+/gu, ' ').slice(0, 36);
        await persistTitle(conversation.sessionId, provisionalTitle);
        conversation.title = provisionalTitle;
        publishTitle(conversation);

        titleUpdate = updateGeneratedTitle(
          conversation,
          input.content,
          provisionalTitle,
          controller.signal,
        );
      }

      try {
        const runtime = await requireCiel();

        await runtime.investigate({
          sessionId: conversation.sessionId,
          target: conversation.target,
          question: input.content,
          memoryAccess: 'read-write',
          crossSpace: true,
          sources: conversation.sources,
          signal: controller.signal,
          onTitleUpdated: title => {
            conversation.title = title;
            publishTitle(conversation);
          },
        });

        await titleUpdate;
      } finally {
        signal?.removeEventListener('abort', abort);
        active.delete(input.sessionId);
      }

      return serializeConversation(conversation);
    });

  const abort = os.input(sessionInputSchema).handler(({ input }) => {
    active.get(input.sessionId)?.abort();
  });

  return {
    router: { list, create, rename, delete: deleteConversation, updates, prompt, abort },
    close: async () => {
      lifetime.abort();

      for (const controller of active.values()) {
        controller.abort();
      }

      active.clear();
      updateListeners.clear();
      conversations.clear();
      await ciel?.close();
    },
  };
}
