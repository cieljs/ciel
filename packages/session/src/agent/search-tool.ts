import { defineTool } from '@cieljs/agent-kit';
import { Type } from 'typebox';

import type { SessionSearchHit, SessionSearchOptions } from '../types.ts';
import { sessionResult } from './helpers.ts';

interface CreateCurrentSearchToolOptions {
  name: 'search_current_session_messages' | 'search_all_session_messages';
  label: string;
  description: string;
  defaultLimit: number;
  search(query: string, options: SessionSearchOptions): Promise<SessionSearchHit[]>;
}

interface CreateScopedSearchToolOptions {
  name: 'search_discovered_session_messages';
  label: string;
  description: string;
  defaultLimit: number;
  authorize(sessionId: string): void;
  search(
    sessionId: string,
    query: string,
    options: SessionSearchOptions,
  ): Promise<SessionSearchHit[]>;
}

const querySchema = {
  query: Type.String({
    minLength: 1,
    description:
      '要查找的历史对话内容，可用关键词或自然语言描述；查来源请用 find_sessions_by_source。',
  }),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 20,
      description: '最多返回的命中消息数，省略时使用宿主配置。',
    }),
  ),
};

export const createCurrentSearchTool = defineTool(
  Type.Object(querySchema),
  (options: CreateCurrentSearchToolOptions) => ({
    name: options.name,
    label: options.label,
    description: options.description,
    execute: async (params, { signal }) =>
      sessionResult({
        query: params.query,
        hits: await options.search(params.query, {
          limit: params.limit ?? options.defaultLimit,
          signal,
        }),
      }),
  }),
);

export const createScopedSearchTool = defineTool(
  Type.Object({
    sessionId: Type.String({
      minLength: 1,
      description: '由 find_sessions_by_source 返回的 session.id。',
    }),
    ...querySchema,
  }),
  (options: CreateScopedSearchToolOptions) => ({
    name: options.name,
    label: options.label,
    description: options.description,
    execute: async (params, { signal }) => {
      options.authorize(params.sessionId);

      const hits = await options.search(params.sessionId, params.query, {
        limit: params.limit ?? options.defaultLimit,
        signal,
      });

      return sessionResult({ sessionId: params.sessionId, query: params.query, hits });
    },
  }),
);
