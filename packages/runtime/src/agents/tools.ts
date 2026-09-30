import type { AgentTool } from '@earendil-works/pi-agent-core';

export function assertUniqueTools(tools: AgentTool[]) {
  const names = new Set<string>();

  for (const tool of tools) {
    if (names.has(tool.name)) {
      throw new Error(`工具名称重复：${tool.name}`);
    }

    names.add(tool.name);
  }
}
