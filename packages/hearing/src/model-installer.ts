import { installFile } from './download.ts';
import type { InstallModelsOptions } from './download.ts';
import { ASR_MODELS, DEFAULT_ASR_MODEL, modelFiles } from './registry.ts';
export type { InstallModelsOptions, ModelInstallProgress } from './download.ts';

export async function installModels(options: InstallModelsOptions): Promise<string> {
  const model = ASR_MODELS[options.model ?? DEFAULT_ASR_MODEL];

  if (!model) {
    throw new Error('Unsupported ASR model');
  }

  await model.prepare(options);
  const ownFiles = new Set(model.files(options.modelsPath).map(file => file.target));

  for (const file of modelFiles(options)) {
    if (!ownFiles.has(file.target)) {
      await installFile(file.url, file.target, options);
    }
  }

  return options.modelsPath;
}
