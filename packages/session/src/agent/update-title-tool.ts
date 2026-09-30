import { defineTool, prompt } from '@cieljs/agent-kit';
import { Type } from 'typebox';

import type { Session } from '../session.ts';
import type { SessionInfo } from '../types.ts';
import { sessionResult } from './helpers.ts';

export const createUpdateSessionTitleTool = defineTool(
  Type.Object({
    title: Type.String({
      minLength: 1,
      maxLength: 80,
      description: '简短、具体、能概括当前会话主题的标题。',
    }),
  }),
  (options: { session: Session; onUpdated?: (session: SessionInfo) => void }) => ({
    name: 'update_current_session_title',
    label: '更新当前会话标题',
    description: prompt.inline`
      更新并持久化当前 Session 的标题。
      当会话主题已经明确，或后续主题发生实质变化时调用；同一会话可以再次更新。
      标题应简短具体，不要包含日期、房间号或主播名等宿主已经展示的信息。
    `,
    executionMode: 'sequential',
    execute: async ({ title }) => {
      const session = await options.session.update({ title });
      options.onUpdated?.(session);

      return sessionResult({ sessionId: session.id, title: session.title });
    },
  }),
);
