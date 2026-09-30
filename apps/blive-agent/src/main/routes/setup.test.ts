import { createRouterClient } from '@orpc/server';
import { expect, it, vi } from 'vite-plus/test';

const mocks = vi.hoisted(() => ({
  install: vi.fn(),
  check: vi.fn(async () => ({ valid: false, missingFiles: ['encoder'], modelsPath: '/models' })),
}));

vi.mock('cieljs/hearing', () => ({
  DEFAULT_ASR_MODEL: 'qwen3-asr-1.7b-int8',
  ASR_MODELS: { 'qwen3-asr-1.7b-int8': {}, 'sensevoice-small': {} },
  installModels: mocks.install,
  checkConfiguration: mocks.check,
}));

vi.mock('../config.ts', () => ({
  watchConfigurationStatus: () => ({ valid: true, path: '/config.json' }),
}));

import { createSetupRoutes } from './setup.ts';

it('已安装模型立即应用，缺失模型下载完成后才替换当前模型', async () => {
  const apply = vi.fn(async () => {});
  const client = createRouterClient(createSetupRoutes('/models', apply));
  mocks.check.mockResolvedValueOnce({ valid: true, missingFiles: [], modelsPath: '/models' });
  await client.selectHearingModel('sensevoice-small');
  expect(apply).toHaveBeenCalledWith('sensevoice-small');
  apply.mockClear();
  await client.selectHearingModel('qwen3-asr-1.7b-int8');
  expect(apply).not.toHaveBeenCalled();

  expect(await client.hearingModels()).toMatchObject({
    model: 'qwen3-asr-1.7b-int8',
    activeModel: 'sensevoice-small',
  });

  const download = Promise.withResolvers<void>();
  mocks.install.mockReturnValueOnce(download.promise);
  await client.installHearingModels();
  expect(apply).not.toHaveBeenCalled();
  download.resolve();
  await vi.waitFor(() => expect(apply).toHaveBeenCalledWith('qwen3-asr-1.7b-int8'));
  mocks.install.mockClear();
});

it('后台安装立即返回、并发去重，失败原因可读取且允许重试', async () => {
  const download = Promise.withResolvers<string>();
  mocks.install.mockReturnValueOnce(download.promise);
  const client = createRouterClient(createSetupRoutes('/models'));
  expect(await client.installHearingModels()).toMatchObject({ installing: true });
  await client.installHearingModels();
  expect(mocks.install).toHaveBeenCalledTimes(1);
  download.reject(new Error('encoder 下载失败：HTTP 503'));

  await vi.waitFor(async () => {
    expect(await client.hearingModels()).toMatchObject({
      installing: false,
      error: 'encoder 下载失败：HTTP 503',
    });
  });

  mocks.install.mockResolvedValueOnce('/models');
  await client.installHearingModels();
  expect(mocks.install).toHaveBeenCalledTimes(2);
  expect((await client.hearingModels()).error).toBeUndefined();
});
