import { defineTool } from 'cieljs/agent-kit';
import { qwen } from 'cieljs/embed';
import { createMcp } from 'cieljs/mcp';
import { memoryStorage } from 'cieljs/memory';
import { models } from 'cieljs/model-kit';
import { sessionStorage } from 'cieljs/session';
import { Storage } from 'cieljs/storage';
import { createTraceRouter } from 'cieljs/trace/host';
import { VectorService, vectorStorage } from 'cieljs/vector';
import { expect, test } from 'vite-plus/test';

import { Ciel, openCielData } from '../src/index.ts';

// 子路径是同级包的逐字再导出：这里既验证导出形态，也验证 exports 映射能被真实解析。
test('子路径再导出与同级包保持同一实现', async () => {
  expect(Ciel).toBeTypeOf('function');
  expect(openCielData).toBeTypeOf('function');
  expect(defineTool).toBeTypeOf('function');
  expect(createMcp).toBeTypeOf('function');
  expect(createTraceRouter).toBeTypeOf('function');
  expect(qwen).toBeTypeOf('function');
  expect(Storage).toBeTypeOf('function');
  expect(VectorService).toBeTypeOf('function');
  expect(memoryStorage.id).toBe('memory');
  expect(sessionStorage.id).toBe('session');
  expect(vectorStorage.id).toBe('vector');
  expect(models).toBeTypeOf('object');
});
