import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRouterClient } from '@orpc/server';
import { expect, it } from 'vite-plus/test';

import { readHearingModel, saveHearingModel } from './hearing-settings.ts';
import { createSetupRoutes } from './routes/setup.ts';

it('重建设置路由后恢复已保存模型，后续切换可以覆盖保存', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'watch-hearing-'));

  try {
    expect(readHearingModel(directory)).toBe('qwen3-asr-1.7b-int8');
    saveHearingModel(directory, 'sensevoice-small');
    const restored = readHearingModel(directory);

    const client = createRouterClient(
      createSetupRoutes(join(directory, 'models'), undefined, restored),
    );

    expect(await client.hearingModels()).toMatchObject({
      model: 'sensevoice-small',
      activeModel: 'sensevoice-small',
    });

    saveHearingModel(directory, 'qwen3-asr-1.7b-int8');
    expect(readHearingModel(directory)).toBe('qwen3-asr-1.7b-int8');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
