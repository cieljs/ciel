import type { AgentTool } from '@earendil-works/pi-agent-core';

import { allMemoryTools } from './all-memory-tools.ts';
import { crossSpaceMemoryTools } from './cross-space-tools.ts';
import { resolveToolOptions } from './helpers.ts';
import { readMemoryTool } from './read-tools.ts';
import {
  searchCurrentSpaceMemoryTool,
  searchCurrentSpaceMemoryBySourceTool,
  searchGlobalMemoryTool,
  searchGlobalMemoryBySourceTool,
} from './search-tools.ts';
import type { GlobalMemoryToolsOptions, MemoryToolsOptions } from './types.ts';
import {
  rememberCurrentSpaceDailyMemoryTool,
  rememberLongTermMemoryTool,
  updateMemoryTool,
  archiveMemoryTool,
} from './write-tools.ts';

// 这里只按调用方授权组装工具，参数协议和执行逻辑放在各领域模块。
export function memoryTools(options: MemoryToolsOptions): AgentTool[] {
  const resolved = resolveToolOptions(options);

  const tools: AgentTool[] = [
    searchCurrentSpaceMemoryTool({ space: options.space, resolved }),
    searchCurrentSpaceMemoryBySourceTool({ space: options.space, resolved }),
    readMemoryTool({
      name: 'read_current_space_memory',
      label: '读取当前空间记忆',
      get: options.space.get.bind(options.space),
      resolved,
    }),
  ];

  if (options.rememberDaily !== false) {
    tools.push(rememberCurrentSpaceDailyMemoryTool({ space: options.space, resolved }));
  }

  if (options.rememberLongTerm !== false) {
    tools.push(
      rememberLongTermMemoryTool({
        name: 'remember_current_space_long_term_memory',
        label: '保存当前空间长期记忆',
        memory: options.space.longTerm,
        resolved,
      }),
    );
  }

  if (options.update !== false) {
    tools.push(
      updateMemoryTool({
        name: 'update_current_space_memory',
        label: '更新当前空间记忆',
        memory: options.space,
        resolved,
      }),
    );
  }

  if (options.archive !== false) {
    tools.push(
      archiveMemoryTool({
        name: 'archive_current_space_memory',
        label: '归档当前空间记忆',
        memory: options.space,
      }),
    );
  }

  if (options.crossSpace) {
    tools.push(...crossSpaceMemoryTools(options.space, options.crossSpace.manager, resolved));

    if (options.crossSpace.access === 'all') {
      tools.push(...allMemoryTools(options.crossSpace.manager, resolved));
    }
  }

  return tools;
}

export function globalMemoryTools(options: GlobalMemoryToolsOptions): AgentTool[] {
  const resolved = resolveToolOptions(options);

  const tools: AgentTool[] = [
    searchGlobalMemoryTool({ memory: options.memory, resolved }),
    searchGlobalMemoryBySourceTool({ memory: options.memory, resolved }),
    readMemoryTool({
      name: 'read_global_memory',
      label: '读取全局长期记忆',
      get: options.memory.get.bind(options.memory),
      resolved,
    }),
  ];

  if (options.remember !== false) {
    tools.push(
      rememberLongTermMemoryTool({
        name: 'remember_global_memory',
        label: '保存全局长期记忆',
        memory: options.memory,
        resolved,
      }),
    );
  }

  if (options.update !== false) {
    tools.push(
      updateMemoryTool({
        name: 'update_global_memory',
        label: '更新全局长期记忆',
        memory: options.memory,
        resolved,
      }),
    );
  }

  if (options.archive !== false) {
    tools.push(
      archiveMemoryTool({
        name: 'archive_global_memory',
        label: '归档全局长期记忆',
        memory: options.memory,
      }),
    );
  }

  return tools;
}

export {
  searchCurrentSpaceMemoryTool,
  searchCurrentSpaceMemoryBySourceTool,
  searchGlobalMemoryTool,
  searchGlobalMemoryBySourceTool,
} from './search-tools.ts';
export { readMemoryTool } from './read-tools.ts';
export {
  rememberCurrentSpaceDailyMemoryTool,
  rememberLongTermMemoryTool,
  updateMemoryTool,
  archiveMemoryTool,
} from './write-tools.ts';
