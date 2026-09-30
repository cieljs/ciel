import { defineTool } from '@cieljs/agent-kit';
import { Type } from 'typebox';

import { investigationResult, type InvestigationToolContext } from './context.ts';

const memoryLayer = Type.Union([Type.Literal('global'), Type.Literal('space')]);
const resultLimitSchema = Type.Integer({ minimum: 1, maximum: 20 });

export const createSearchMemoryTool = defineTool(
  Type.Object({
    query: Type.String({ minLength: 1 }),
    limit: Type.Optional(resultLimitSchema),
  }),
  ({ options, memorySpace, targetSpaceId }: InvestigationToolContext) => ({
    name: 'search_memory',
    label: '搜索记忆',
    description:
      options.target.type === 'global'
        ? '只读搜索全部空间与全局长期记忆。调查目标和来源由宿主注入，结果是可能过时的历史资料。'
        : '只读搜索目标空间记忆与全局长期记忆。调查目标和来源由宿主注入，结果是可能过时的历史资料。',
    execute: async ({ query, limit = 8 }, { signal }) => {
      const sources = options.resolveSources();

      if (options.target.type === 'global') {
        const memories = await options.memoryManager.searchAll(query, { limit, signal });

        return investigationResult({ target: options.target, sources, memories });
      }

      const [space, global] = await Promise.all([
        memorySpace.search(query, { limit, signal }),
        options.memoryManager.global.search(query, { limit, signal }),
      ]);

      return investigationResult({ spaceId: targetSpaceId, sources, space, global });
    },
  }),
);

export const createReadMemoryTool = defineTool(
  Type.Object({
    id: Type.String({ minLength: 1 }),
    layer: memoryLayer,
  }),
  ({ options, memorySpace, targetSpaceId }: InvestigationToolContext) => ({
    name: 'read_memory',
    label: '读取记忆',
    description:
      options.target.type === 'global'
        ? '按 ID 只读获取任意空间或全局长期记忆。'
        : '按 ID 只读获取目标空间或全局长期记忆；不能用它读取其他空间。',
    execute: async ({ id, layer }, { signal }) => {
      signal?.throwIfAborted();
      const sources = options.resolveSources();
      let memory;

      if (options.target.type === 'global') {
        memory = await options.memoryManager.getAcrossSpaces(id);
      } else {
        const store = layer === 'global' ? options.memoryManager.global : memorySpace;
        memory = await store.get(id);
      }

      signal?.throwIfAborted();

      return investigationResult({ spaceId: targetSpaceId, sources, memory });
    },
  }),
);
