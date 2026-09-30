import { defineTool } from '@cieljs/agent-kit';
import { Type } from 'typebox';
import { expect, test } from 'vite-plus/test';

import { assertUniqueTools } from '../src/agents/tools.ts';

test('拒绝重复工具名称', () => {
  const tool = defineTool(Type.Object({}), () => ({
    name: 'search_memory',
    label: '搜索记忆',
    description: 'test',
    execute: async () => ({ content: [], details: {} }),
  }))();

  expect(() => assertUniqueTools([tool, tool])).toThrow('工具名称重复：search_memory');
});
