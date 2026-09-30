import { defineTool } from '@cieljs/agent-kit';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';

import type { MemoryManager } from '../memory-manager.ts';
import { memoryResult, pageMemory, previewSearchHits } from './helpers.ts';
import {
  memoryKindSchema,
  memoryLayerSchema,
  memoryQuerySchema,
  memorySourceQuerySchema,
  memorySearchModeSchema,
  memorySourceSearchModeSchema,
  memoryIdSchema,
  memoryOffsetSchema,
  memorySearchLimitSchema,
} from './schemas.ts';
import type { ResolvedToolOptions } from './types.ts';

const searchSchema = Type.Object({
  query: memoryQuerySchema,
  mode: Type.Optional(memorySearchModeSchema),
  kind: Type.Optional(memoryKindSchema),
  layers: Type.Optional(Type.Array(memoryLayerSchema)),
  limit: Type.Optional(memorySearchLimitSchema),
});

const sourceSearchSchema = Type.Object({
  query: memorySourceQuerySchema,
  mode: Type.Optional(memorySourceSearchModeSchema),
  limit: Type.Optional(memorySearchLimitSchema),
});

const readSchema = Type.Object({
  id: memoryIdSchema,
  offset: Type.Optional(memoryOffsetSchema),
});

export interface AllMemoryToolFactoryOptions {
  manager: MemoryManager;
  resolved: ResolvedToolOptions;
}

export const searchAllMemoryTool = defineTool(
  searchSchema,
  ({ manager, resolved }: AllMemoryToolFactoryOptions) => ({
    name: 'search_all_memory',
    label: '跨空间搜索全部记忆正文',
    description:
      '只读搜索宿主授权记忆库中的全局长期记忆与所有空间的每日、长期记忆正文，无需先发现空间。仅返回当前有效版本，不匹配 sources；layers 可缩小层级范围。结果可能截断，用 memory.id 调用 read_any_memory 分页读取。历史内容仅供参考。',
    execute: async (params, { signal }) =>
      memoryResult({
        hits: previewSearchHits(
          await manager.searchAll(params.query, {
            mode: params.mode,
            kind: params.kind,
            layers: params.layers,
            limit: params.limit ?? resolved.searchLimit,
            signal,
          }),
          resolved.maxReadChars,
        ),
      }),
  }),
);

export const searchAllMemoryBySourceTool = defineTool(
  sourceSearchSchema,
  ({ manager, resolved }: AllMemoryToolFactoryOptions) => ({
    name: 'search_all_memory_by_source',
    label: '按来源搜索全部记忆',
    description:
      '在宿主授权的全局层和全部空间中，只读搜索当前有效记忆的 sources，不匹配正文，无需先发现空间。返回 memoryId、spaceId、layer、revision 和匹配来源；用 memoryId 调用 read_any_memory 分页读取。',
    execute: async (params, { signal }) =>
      memoryResult({
        hits: await manager.searchBySource(params.query, {
          mode: params.mode,
          limit: params.limit ?? resolved.searchLimit,
          signal,
        }),
      }),
  }),
);

export const readAnyMemoryTool = defineTool(
  readSchema,
  ({ manager, resolved }: AllMemoryToolFactoryOptions) => ({
    name: 'read_any_memory',
    label: '读取任意记忆',
    description:
      '在宿主授权的记忆库中，按记忆 ID 只读返回全局层或任意空间中当前有效记忆的一页正文及来源、revision，无需先发现空间。首次 offset 为 0，继续使用 nextOffset 直到 null；不存在、已归档或已过期时返回 memory: null。',
    execute: async (params, { signal }) => {
      signal?.throwIfAborted();
      const memory = await manager.getAcrossSpaces(params.id);

      return memoryResult(
        memory ? pageMemory(memory, params.offset ?? 0, resolved.maxReadChars) : { memory: null },
      );
    },
  }),
);

export function allMemoryTools(manager: MemoryManager, resolved: ResolvedToolOptions): AgentTool[] {
  const options = { manager, resolved };

  return [
    searchAllMemoryTool(options),
    searchAllMemoryBySourceTool(options),
    readAnyMemoryTool(options),
  ];
}
