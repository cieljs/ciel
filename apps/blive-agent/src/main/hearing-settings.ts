import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ASR_MODELS, DEFAULT_ASR_MODEL, type ASRModelId } from 'cieljs/hearing';
import * as z from 'zod';

const settingsSchema = z.object({ model: z.enum(Object.keys(ASR_MODELS) as ASRModelId[]) });

export function readHearingModel(directory: string): ASRModelId {
  const file = join(directory, 'hearing.json');

  if (!existsSync(file)) {
    return DEFAULT_ASR_MODEL;
  }

  return settingsSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).model;
}

export function saveHearingModel(directory: string, model: ASRModelId): void {
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'hearing.json');
  // 独立保存听觉选择，不改写包含 AI 凭据的配置；临时文件避免重启读到半份 JSON。
  writeFileSync(`${file}.tmp`, `${JSON.stringify({ model }, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}
