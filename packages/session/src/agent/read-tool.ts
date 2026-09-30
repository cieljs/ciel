import { defineTool } from '@cieljs/agent-kit';
import { Type } from 'typebox';

import type { Session } from '../session.ts';
import { sessionResult } from './helpers.ts';

interface CreateCurrentReadToolOptions {
  name: 'read_current_session_messages';
  label: string;
  description: string;
  maxReadMessages: number;
  session: Session;
}

interface CreateScopedReadToolOptions {
  name: 'read_discovered_session_messages' | 'read_any_session_messages';
  label: string;
  description: string;
  maxReadMessages: number;
  authorize?(sessionId: string): void;
  getSession(sessionId: string): Promise<Session>;
}

const rangeSchema = {
  messageId: Type.String({
    minLength: 1,
    description: '目标消息的 ID，使用正文搜索结果中的 message.id，不是消息序号。',
  }),
  before: Type.Optional(
    Type.Integer({
      minimum: 0,
      maximum: 20,
      description: '目标消息之前的消息条数，默认 2，实际不超过宿主设置的上限。',
    }),
  ),
  after: Type.Optional(
    Type.Integer({
      minimum: 0,
      maximum: 20,
      description: '目标消息之后的消息条数，默认 2，实际不超过宿主设置的上限。',
    }),
  ),
};

export const createCurrentReadTool = defineTool(
  Type.Object(rangeSchema),
  (options: CreateCurrentReadToolOptions) => ({
    name: options.name,
    label: options.label,
    description: options.description,
    execute: (params, { signal }) =>
      readAround(
        options.session,
        params.messageId,
        params.before,
        params.after,
        options.maxReadMessages,
        signal,
      ),
  }),
);

export const createScopedReadTool = defineTool(
  Type.Object({
    sessionId: Type.String({
      minLength: 1,
      description:
        '目标会话 ID，使用发现结果中的 session.id 或正文搜索结果中的 message.sessionId。',
    }),
    ...rangeSchema,
  }),
  (options: CreateScopedReadToolOptions) => ({
    name: options.name,
    label: options.label,
    description: options.description,
    execute: async (params, { signal }) => {
      options.authorize?.(params.sessionId);
      const session = await options.getSession(params.sessionId);

      return readAround(
        session,
        params.messageId,
        params.before,
        params.after,
        options.maxReadMessages,
        signal,
      );
    },
  }),
);

async function readAround(
  session: Session,
  messageId: string,
  before = 2,
  after = 2,
  maxReadMessages: number,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const target = await session.getMessage(messageId);

  if (!target) {
    return sessionResult({
      spaceId: session.spaceId,
      sessionId: session.id,
      messageId,
      messages: [],
    });
  }

  const messages = await session.getMessagesRange(
    Math.max(1, target.seq - Math.min(before, maxReadMessages)),
    target.seq + Math.min(after, maxReadMessages),
  );

  signal?.throwIfAborted();

  return sessionResult({ spaceId: session.spaceId, sessionId: session.id, messageId, messages });
}
