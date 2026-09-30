// @env node

import { createWriteStream } from 'node:fs';
import { stat, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';

import type { ASROptions } from './types.ts';

export interface ModelInstallProgress {
  file: string;
  receivedBytes: number;
  totalBytes?: number;
  attempt?: number;
  message?: string;
}

export interface InstallModelsOptions extends Pick<
  ASROptions,
  'modelsPath' | 'model' | 'speaker' | 'mode'
> {
  force?: boolean;
  retries?: number;
  retryDelayMs?: number;
  onProgress?: (progress: ModelInstallProgress) => void;
}

const installations = new Map<string, Promise<void>>();

export function installFile(
  url: string,
  target: string,
  options: InstallModelsOptions,
): Promise<void> {
  const key = path.resolve(target);
  const pending = installations.get(key);

  if (pending) {
    return pending;
  }

  const operation = downloadFile(url, target, options).finally(() => installations.delete(key));
  installations.set(key, operation);

  return operation;
}

// oxlint-disable-next-line eslint/complexity -- 下载流必须在同一生命周期处理重定向、取消、校验和临时文件。
async function downloadFile(
  url: string,
  target: string,
  options: InstallModelsOptions,
): Promise<void> {
  if (!options.force && (await exists(target))) {
    return;
  }

  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.part`;

  const attempts = (options.retries ?? 2) + 1;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      options.onProgress?.({ file: path.basename(target), receivedBytes: 0, attempt });
      await download(url, temporary, progress => options.onProgress?.({ ...progress, attempt }));
      await rename(temporary, target);

      return;
    } catch (cause) {
      await rm(temporary, { force: true });
      const details = [cause instanceof Error ? cause.message : String(cause)];

      if (cause instanceof Error && cause.cause instanceof Error) {
        details.push(cause.cause.message);
      }

      const detail = details.join('：');
      const message = `${path.basename(target)} 下载失败（第 ${attempt}/${attempts} 次）：${detail}`;

      if (attempt === attempts) {
        throw new Error(message, { cause });
      }

      options.onProgress?.({ file: path.basename(target), receivedBytes: 0, attempt, message });
      await delay((options.retryDelayMs ?? 1_000) * attempt);
    }
  }
}

async function download(
  url: string,
  target: string,
  onProgress?: (progress: ModelInstallProgress) => void,
): Promise<void> {
  const controller = new AbortController();
  const connectionTimer = setTimeout(() => controller.abort(), 30_000);
  let response: Response;

  try {
    response = await fetch(url, { redirect: 'follow', signal: controller.signal });
  } finally {
    clearTimeout(connectionTimer);
  }

  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`模型下载失败（HTTP ${response.status}）：${url}`);
  }

  const file = path.basename(target).replace(/\.part$/u, '');
  const contentLength = Number(response.headers.get('content-length'));

  const totalBytes =
    Number.isFinite(contentLength) && contentLength > 0 ? contentLength : undefined;

  let receivedBytes = 0;

  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;
      onProgress?.({ file, receivedBytes, totalBytes });
      callback(null, chunk);
    },
  });

  onProgress?.({ file, receivedBytes, totalBytes });

  await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(target), {
    signal: AbortSignal.timeout(30 * 60_000),
  });

  if (receivedBytes === 0 || (totalBytes !== undefined && receivedBytes !== totalBytes)) {
    throw new Error(`模型文件不完整：${file}（${receivedBytes}/${totalBytes ?? '未知'} 字节）`);
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    const info = await stat(target);

    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}
