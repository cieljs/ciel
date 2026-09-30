import { globalMemoryTools, memoryTools } from '@cieljs/memory/agent';
import type { AgentTool } from '@earendil-works/pi-agent-core';

import {
  createInvestigationToolContext,
  type InvestigationToolOptions,
} from './investigation-tools/context.ts';
import { createReadMemoryTool, createSearchMemoryTool } from './investigation-tools/memory.ts';
import {
  createReadSessionTool,
  createReadTargetSessionTool,
  createSearchSessionsTool,
} from './investigation-tools/sessions.ts';

/** 调查写权限只作用于宿主指定目标；跨空间始终只是检索能力。 */
export function createInvestigationTools(options: InvestigationToolOptions): AgentTool[] {
  const context = createInvestigationToolContext(options);

  const tools: AgentTool[] = [
    createSearchMemoryTool(context),
    createReadMemoryTool(context),
    createSearchSessionsTool(context),
    createReadSessionTool(context),
    createReadTargetSessionTool(context),
  ];

  const canWrite = options.memoryAccess === 'read-write';

  const sources = () => [
    `investigation:${options.investigationSessionId}`,
    ...options.resolveSources(),
  ];

  if (options.target.type === 'global') {
    return [
      ...globalMemoryTools({
        memory: options.memoryManager.global,
        sources,
        remember: canWrite,
        update: canWrite,
        archive: canWrite,
      }),
      ...tools,
    ];
  }

  return [
    ...memoryTools({
      space: context.memorySpace,
      sources,
      crossSpace: options.crossSpace
        ? { manager: options.memoryManager, access: 'related' }
        : undefined,
      rememberDaily: canWrite,
      rememberLongTerm: canWrite,
      update: canWrite,
      archive: canWrite,
    }),
    ...tools,
  ];
}
