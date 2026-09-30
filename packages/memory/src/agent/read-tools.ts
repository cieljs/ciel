import { defineTool } from '@cieljs/agent-kit';

import { memoryResult, pageMemory } from './helpers.ts';
import { readSchema } from './schemas.ts';
import type { ReadToolOptions } from './tool-context.ts';

export const readMemoryTool = defineTool(
  readSchema,
  ({ name, label, get, resolved }: ReadToolOptions) => ({
    name,
    label,
    description: `${label}：按记忆 ID 返回当前有效版本的一页正文及来源、revision 等信息。范围固定为工具名称指定的层级。首次 offset 为 0，后续使用返回的 nextOffset，直到 null 才表示读完。不存在、已归档、已过期或不在范围内时返回 memory: null。历史内容仅供参考。`,
    execute: async (params, { signal }) => {
      signal?.throwIfAborted();
      const memory = await get(params.id);
      signal?.throwIfAborted();

      return memoryResult(
        memory ? pageMemory(memory, params.offset ?? 0, resolved.maxReadChars) : { memory: null },
      );
    },
  }),
);
