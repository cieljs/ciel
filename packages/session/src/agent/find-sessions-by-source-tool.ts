import { defineTool, prompt } from '@cieljs/agent-kit';
import { Type } from 'typebox';

import type { FindSessionsBySourceOptions, SessionSourceHit } from '../types.ts';
import { sessionResult } from './helpers.ts';

interface SessionSourceFinder {
  findSessionsBySource(
    query: string,
    options?: FindSessionsBySourceOptions,
  ): Promise<SessionSourceHit[]>;
}

interface FindSessionsBySourceToolOptions {
  finder: SessionSourceFinder;
  discovered: Set<string>;
  searchLimit: number;
  scopeDescription: string;
}

const resultLimitSchema = Type.Integer({ minimum: 1, maximum: 20 });

export const findSessionsBySourceTool = defineTool(
  Type.Object({
    query: Type.String({
      minLength: 1,
      description: '要匹配的 Session 来源，例如业务 ID、用户或房间名称、昵称、标题或别名。',
    }),
    limit: Type.Optional(resultLimitSchema),
  }),
  (options: FindSessionsBySourceToolOptions) => ({
    name: 'find_sessions_by_source',
    label: '按来源发现会话',
    description: prompt.inline`
      在${options.scopeDescription}中，按 sources 查找相关会话。
      sources 是宿主记录的业务 ID、用户或房间名称、昵称、标题和别名；只匹配来源，不搜索消息正文。
      返回 session.id、session.spaceId 和 matchedSources；将 session.id 交给 search_discovered_session_messages 搜索正文，再用 read_discovered_session_messages 查看前后文。
      已发现会话可在本组工具实例存续期间继续访问；此工具只读，不枚举全部会话。
    `,
    execute: async (params, { signal }) => {
      const hits = await options.finder.findSessionsBySource(params.query, {
        limit: params.limit ?? options.searchLimit,
        signal,
      });

      for (const hit of hits) {
        options.discovered.add(hit.session.id);
      }

      return sessionResult({ query: params.query, hits });
    },
  }),
);
