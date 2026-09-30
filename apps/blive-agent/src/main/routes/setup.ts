import { os } from '@orpc/server';
import {
  checkConfiguration,
  installModels,
  ASR_MODELS,
  DEFAULT_ASR_MODEL,
  type ASRModelId,
  type ModelInstallProgress,
} from 'cieljs/hearing';
import * as z from 'zod';

import { watchConfigurationStatus } from '../config.ts';

/** 安装任务由主进程持有，刷新页面不会重复下载或丢失错误。 */
export function createSetupRoutes(
  modelsPath: string,
  onModel: (model: ASRModelId) => Promise<void> = async () => {},
  initialModel: ASRModelId = DEFAULT_ASR_MODEL,
) {
  let installation: Promise<void> | undefined;
  let progress: ModelInstallProgress | undefined;
  let error: string | undefined;
  let model = initialModel;
  let activeModel = initialModel;
  let switching = false;

  async function activate() {
    await onModel(model);
    activeModel = model;
  }

  async function status() {
    return {
      ...(await checkConfiguration({ modelsPath, model })),
      model,
      activeModel,
      availableModels: Object.keys(ASR_MODELS) as ASRModelId[],
      installing: installation !== undefined,
      progress,
      error,
    };
  }

  return {
    configuration: os.handler(() => watchConfigurationStatus()),
    hearingModels: os.handler(status),
    selectHearingModel: os
      .input(z.enum(['qwen3-asr-1.7b-int8', 'sensevoice-small']))
      .handler(async ({ input }) => {
        if (installation || switching) {
          throw new Error('请等待当前模型准备完成');
        }

        switching = true;

        try {
          model = input;
          error = undefined;
          progress = undefined;

          if ((await checkConfiguration({ modelsPath, model })).valid) {
            await activate();
          }
        } catch (cause) {
          error = cause instanceof Error ? cause.message : String(cause);
          throw cause;
        } finally {
          switching = false;
        }

        return status();
      }),
    installHearingModels: os.handler(() => {
      if (switching) {
        throw new Error('请等待当前模型切换完成');
      }

      if (!installation) {
        error = undefined;
        progress = undefined;

        installation = installModels({
          modelsPath,
          model,
          onProgress: value => {
            progress = value;
          },
        })
          .then(async () => {
            await activate();
            progress = undefined;
          })
          .catch(cause => {
            error = cause instanceof Error ? cause.message : String(cause);
          })
          .finally(() => {
            installation = undefined;
          });
      }

      // 立即返回，避免大模型下载耗时超过 RPC 请求生命周期。
      return status();
    }),
  };
}
