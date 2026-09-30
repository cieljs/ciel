import { defineTool } from '@cieljs/agent-kit';
import { Type } from 'typebox';

import { investigationResult, type InvestigationToolContext } from './context.ts';

const resultLimitSchema = Type.Integer({ minimum: 1, maximum: 20 });
const contextRadiusSchema = Type.Integer({ minimum: 0, maximum: 20 });
const sequenceSchema = Type.Integer({ minimum: 0 });
const pageSizeSchema = Type.Integer({ minimum: 1, maximum: 100 });

export const createSearchSessionsTool = defineTool(
  Type.Object({
    query: Type.String({ minLength: 1 }),
    limit: Type.Optional(resultLimitSchema),
  }),
  ({ options, sessionSpace, targetSpaceId }: InvestigationToolContext) => ({
    name: 'search_sessions',
    label: '搜索会话',
    description:
      options.target.type === 'global' || options.crossSpace
        ? '只读搜索全部空间的普通 Session 正文，结果包含来源和 Session ID；不搜索 Investigation Session。'
        : '只读搜索目标空间的普通 Session 正文，不搜索 Investigation Session。',
    execute: async ({ query, limit = 8 }, { signal }) => {
      const sources = options.resolveSources();
      // 检索范围取自宿主配置，模型只能提供查询词。
      let hits;

      if (options.target.type === 'global' || options.crossSpace) {
        hits = await options.sessionManager.searchAll(query, { limit, signal });
      } else {
        hits = await sessionSpace.search(query, { limit, signal });
      }

      return investigationResult({ spaceId: targetSpaceId, sources, hits });
    },
  }),
);

export const createReadSessionTool = defineTool(
  Type.Object({
    sessionId: Type.String({ minLength: 1 }),
    messageId: Type.String({ minLength: 1 }),
    before: Type.Optional(contextRadiusSchema),
    after: Type.Optional(contextRadiusSchema),
  }),
  ({ options, sessionSpace, targetSpaceId }: InvestigationToolContext) => ({
    name: 'read_session',
    label: '读取会话消息',
    description:
      options.target.type === 'global' || options.crossSpace
        ? '按搜索结果的 Session ID 和消息 ID，只读获取任意空间普通 Session 的局部上下文。'
        : '按 Session ID 和消息 ID 只读获取目标空间普通 Session 的局部上下文。',
    execute: async ({ sessionId, messageId, before = 3, after = 3 }, { signal }) => {
      signal?.throwIfAborted();
      const sources = options.resolveSources();
      let session;

      if (options.target.type === 'global' || options.crossSpace) {
        session = await options.sessionManager.getSessionAcrossSpaces(sessionId);
      } else {
        session = await sessionSpace.getSession(sessionId);
      }

      if (!session) {
        return investigationResult({ spaceId: targetSpaceId, sources, messages: [] });
      }

      const message = await session.getMessage(messageId);

      if (!message) {
        return investigationResult({ spaceId: targetSpaceId, sources, messages: [] });
      }

      const messages = await session.getMessagesRange(
        Math.max(1, message.seq - before),
        message.seq + after,
      );

      signal?.throwIfAborted();

      return investigationResult({
        spaceId: targetSpaceId,
        sources,
        sessionId,
        messageId,
        messages,
      });
    },
  }),
);

export const createReadTargetSessionTool = defineTool(
  Type.Object({
    afterSeq: Type.Optional(sequenceSchema),
    limit: Type.Optional(pageSizeSchema),
  }),
  ({ options }: InvestigationToolContext) => ({
    name: 'read_target_session',
    label: '读取目标会话',
    description:
      '按顺序分页读取宿主指定的普通 Session。afterSeq 初次为 0，后续使用最后一条消息的 seq；不能改变目标 Session。',
    execute: async ({ afterSeq = 0, limit = 50 }, { signal }) => {
      signal?.throwIfAborted();

      if (options.target.type !== 'space' || !options.target.sessionId) {
        return investigationResult({ target: options.target, messages: [], nextSeq: null });
      }

      const session = await options.sessionManager
        .space(options.target.spaceId)
        .getSession(options.target.sessionId);

      if (!session) {
        return investigationResult({ target: options.target, messages: [], nextSeq: null });
      }

      const messages = await session.getMessages({ afterSeq, limit });
      const nextSeq = messages.length === limit ? messages.at(-1)!.seq : null;

      return investigationResult({ target: options.target, messages, nextSeq });
    },
  }),
);
