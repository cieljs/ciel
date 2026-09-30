import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { models } from 'cieljs/model-kit/models';
import { app } from 'electron';
import * as z from 'zod';

import { copyMissingResources } from './resources.ts';

const requiredTextSchema = z.string().trim().min(1);
const intervalSchema = z.number().int().min(500);
const durationSchema = z.number().int().min(1_000);
const waitDurationSchema = z.number().int().nonnegative();

const wakeConfigSchema = z
  .object({
    keywords: z.array(requiredTextSchema).min(1).default(['夏尔']),
    minWaitMs: waitDurationSchema.default(1500),
    maxWaitMs: waitDurationSchema.default(4000),
    cooldownMs: waitDurationSchema.default(15000),
  })
  .refine(value => value.maxWaitMs >= value.minWaitMs, 'maxWaitMs 不能小于 minWaitMs');

const watchConfigSchema = z.object({
  ai: z.object({
    provider: requiredTextSchema,
    model: requiredTextSchema,
    apiKey: requiredTextSchema,
    baseUrl: z
      .string()
      .trim()
      .url()
      .refine(value => /^https?:\/\//u.test(value), '仅支持 HTTP 或 HTTPS 地址')
      .optional(),
    /** 推理强度；省略时沿用模型默认（当前 mimo 等价于关闭）。 */
    thinkingLevel: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
  }),
  interaction: z
    .object({
      minimumThinkIntervalMs: intervalSchema.default(2_000),
      periodicObservationMs: durationSchema.default(10_000),
      /** 单轮思考的时间预算；超过就中止本轮，省略表示不限制。 */
      thinkTimeoutMs: durationSchema.optional(),
    })
    .prefault({}),
  wake: z.union([z.literal(false), wakeConfigSchema]).prefault({}),
  ffmpegPath: requiredTextSchema.optional(),
});

export type WatchConfig = z.infer<typeof watchConfigSchema>;

export function resolveWatchConfig(): WatchConfig {
  const file = watchConfigFile();

  if (!existsSync(file)) {
    throw new Error(`请创建 ${file}，填写 ai.provider、ai.model、ai.apiKey`);
  }

  let input: unknown;

  try {
    input = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取 Blive Agent 配置：${file}`, { cause: error });
  }

  const result = watchConfigSchema.safeParse(input);

  if (!result.success) {
    const details = result.error.issues
      .map(issue => `${issue.path.join('.') || 'config'}：${issue.message}`)
      .join('；');

    throw new Error(`Blive Agent 配置不合法：${details}`);
  }

  return result.data;
}

export function resolveWatchModel(config = resolveWatchConfig()) {
  const model = models.getModel(config.ai.provider, config.ai.model);

  if (!model) {
    throw new Error(`模型不存在：${config.ai.provider}/${config.ai.model}`);
  }

  // 只覆盖当前运行使用的模型，避免污染共享注册信息。
  const resolvedModel = config.ai.baseUrl ? { ...model, baseUrl: config.ai.baseUrl } : model;

  return { model: resolvedModel, apiKey: config.ai.apiKey };
}

export function watchConfigurationStatus() {
  const path = watchConfigFile();

  try {
    const config = resolveWatchConfig();
    resolveWatchModel(config);

    return { path, valid: true as const };
  } catch (error) {
    return {
      path,
      valid: false as const,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function watchConfigFile() {
  return join(watchDataDirectory(), 'config.json');
}

export function watchDataDirectory() {
  return resolve(
    process.env.BLIVE_AGENT_DATA_DIR ?? join(app.isPackaged ? homedir() : process.cwd(), '.ciel'),
  );
}

export function prepareWatchResources() {
  const root = watchDataDirectory();

  for (const name of ['electron', 'models', 'voiceprints', 'cache', 'logs']) {
    mkdirSync(join(root, name), { recursive: true });
  }

  app.setPath('sessionData', join(root, 'electron'));
  app.setAppLogsPath(join(root, 'logs'));
}

export async function migrateWatchResources() {
  const root = watchDataDirectory();
  const previousRoots = [join(app.getAppPath(), '.ciel'), join(app.getPath('userData'), '.ciel')];

  for (const previous of previousRoots) {
    if (resolve(previous) === root || !existsSync(previous)) {
      continue;
    }

    for (const name of ['session', 'memory', 'investigation', 'trace', 'mcp.json']) {
      const source = join(previous, name);
      const target = join(root, name);

      if (existsSync(source) && !existsSync(target)) {
        await cp(source, target, { recursive: true, force: false });
      }
    }

    for (const name of ['models', 'voiceprints', 'cache']) {
      const source = join(previous, name);

      if (existsSync(source)) {
        await copyMissingResources(source, join(root, name));
      }
    }
  }
}
