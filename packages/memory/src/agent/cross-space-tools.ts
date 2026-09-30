import { defineTool } from '@cieljs/agent-kit';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';

import { MemoryAccessError } from '../errors.ts';
import type { MemoryManager } from '../memory-manager.ts';
import type { SpaceMemory } from '../memory-store.ts';
import { memoryResult, pageMemory, previewSearchHits } from './helpers.ts';
import {
  memoryKindSchema,
  memoryQuerySchema,
  memorySourceQuerySchema,
  memorySearchModeSchema,
  memorySourceSearchModeSchema,
  memoryIdSchema,
  memoryOffsetSchema,
  memorySearchLimitSchema,
} from './schemas.ts';
import type { ResolvedToolOptions } from './types.ts';

const sourceSearchSchema = Type.Object({
  query: memorySourceQuerySchema,
  mode: Type.Optional(memorySourceSearchModeSchema),
  limit: Type.Optional(memorySearchLimitSchema),
});

const spaceSearchSchema = Type.Object({
  spaceId: Type.String({
    minLength: 1,
    description:
      '当前空间 ID，或本组工具 find_memory_spaces_by_source 返回的 spaceId；不能指定未发现的其他空间。',
  }),
  query: memoryQuerySchema,
  mode: Type.Optional(memorySearchModeSchema),
  kind: Type.Optional(memoryKindSchema),
  limit: Type.Optional(memorySearchLimitSchema),
});

const spaceSourceSearchSchema = Type.Intersect([
  sourceSearchSchema,
  Type.Object({
    spaceId: Type.String({
      minLength: 1,
      description:
        '当前空间 ID，或本组工具 find_memory_spaces_by_source 返回的 spaceId；不能指定未发现的其他空间。',
    }),
  }),
]);

const spaceReadSchema = Type.Object({
  spaceId: Type.String({
    minLength: 1,
    description:
      '当前空间 ID，或本组工具 find_memory_spaces_by_source 返回的 spaceId；不能指定未发现的其他空间。',
  }),
  id: memoryIdSchema,
  offset: Type.Optional(memoryOffsetSchema),
});

export interface CrossSpaceToolFactoryOptions {
  manager: MemoryManager;
  discoveredSpaces: Set<string>;
  resolved: ResolvedToolOptions;
}

export const findMemorySpacesBySourceTool = defineTool(
  sourceSearchSchema,
  ({ manager, discoveredSpaces, resolved }: CrossSpaceToolFactoryOptions) => ({
    name: 'find_memory_spaces_by_source',
    label: '按记忆来源发现空间',
    description:
      '在宿主授权的记忆库中，按记忆的 sources 查找相关空间；不搜索正文或全局层，不枚举空空间。返回 spaceId、匹配来源和记忆引用。发现结果在本组工具实例存续期间允许后续只读探索；先用 search_discovered_space_memory 查正文，再用 read_discovered_space_memory 分页读取，不增加写入权限。',
    execute: async (params, { signal }) => {
      const spaces = await manager.findSpacesBySource(params.query, {
        mode: params.mode,
        limit: params.limit ?? resolved.searchLimit,
        signal,
      });

      for (const space of spaces) {
        discoveredSpaces.add(space.spaceId);
      }

      return memoryResult({ spaces });
    },
  }),
);

export const searchDiscoveredSpaceMemoryTool = defineTool(
  spaceSearchSchema,
  ({ manager, discoveredSpaces, resolved }: CrossSpaceToolFactoryOptions) => ({
    name: 'search_discovered_space_memory',
    label: '搜索已发现空间记忆正文',
    description:
      '只读搜索指定 spaceId 内未归档、未过期的每日和长期记忆正文，不搜索 sources 或全局层。当前空间已允许访问；其他空间必须先由本组工具的 find_memory_spaces_by_source 发现。结果可能截断，用 memory.id 和对应 spaceId 调用 read_discovered_space_memory 分页读取。',
    execute: async (params, { signal }) => {
      assertDiscovered(discoveredSpaces, params.spaceId);

      const hits = await manager.space(params.spaceId).search(params.query, {
        mode: params.mode,
        kind: params.kind,
        limit: params.limit ?? resolved.searchLimit,
        signal,
      });

      return memoryResult({ hits: previewSearchHits(hits, resolved.maxReadChars) });
    },
  }),
);

export const searchDiscoveredSpaceMemoryBySourceTool = defineTool(
  spaceSourceSearchSchema,
  ({ manager, discoveredSpaces, resolved }: CrossSpaceToolFactoryOptions) => ({
    name: 'search_discovered_space_memory_by_source',
    label: '按来源搜索已发现空间记忆',
    description:
      '只读匹配指定 spaceId 中当前有效记忆的 sources，不搜索正文或全局层。当前空间已允许访问；其他空间必须先由 find_memory_spaces_by_source 发现。结果的 memoryId 可交给 read_discovered_space_memory，并使用同一 spaceId 读取正文。',
    execute: async (params, { signal }) => {
      assertDiscovered(discoveredSpaces, params.spaceId);

      const hits = await manager.space(params.spaceId).searchBySource(params.query, {
        mode: params.mode,
        limit: params.limit ?? resolved.searchLimit,
        signal,
      });

      return memoryResult({ hits });
    },
  }),
);

export const readDiscoveredSpaceMemoryTool = defineTool(
  spaceReadSchema,
  ({ manager, discoveredSpaces, resolved }: CrossSpaceToolFactoryOptions) => ({
    name: 'read_discovered_space_memory',
    label: '读取已发现空间记忆',
    description:
      '只读返回指定空间中某条当前有效记忆的一页正文、来源和 revision。当前空间已允许访问；其他空间必须先由 find_memory_spaces_by_source 发现。首次 offset 为 0，继续使用 nextOffset 直到 null；记忆不存在、已归档、已过期或不属于该空间时返回 memory: null。',
    execute: async (params, { signal }) => {
      assertDiscovered(discoveredSpaces, params.spaceId);
      signal?.throwIfAborted();
      const memory = await manager.space(params.spaceId).get(params.id);

      return memoryResult(
        memory ? pageMemory(memory, params.offset ?? 0, resolved.maxReadChars) : { memory: null },
      );
    },
  }),
);

export function crossSpaceMemoryTools(
  currentSpace: SpaceMemory,
  manager: MemoryManager,
  resolved: ResolvedToolOptions,
): AgentTool[] {
  const options: CrossSpaceToolFactoryOptions = {
    manager,
    resolved,
    discoveredSpaces: new Set([currentSpace.spaceId]),
  };

  return [
    findMemorySpacesBySourceTool(options),
    searchDiscoveredSpaceMemoryTool(options),
    searchDiscoveredSpaceMemoryBySourceTool(options),
    readDiscoveredSpaceMemoryTool(options),
  ];
}

function assertDiscovered(spaces: Set<string>, spaceId: string): void {
  if (!spaces.has(spaceId)) {
    throw new MemoryAccessError('必须先通过 find_memory_spaces_by_source 发现这个 space');
  }
}
