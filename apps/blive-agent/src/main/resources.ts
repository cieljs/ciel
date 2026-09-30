import { constants } from 'node:fs';
import { mkdir, readdir, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** 允许目标目录已经存在；逐文件补齐，绝不覆盖已有资源。 */
export async function copyMissingResources(source: string, target: string): Promise<void> {
  if (resolve(source) === resolve(target)) {
    return;
  }

  await mkdir(target, { recursive: true });

  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);

    if (entry.isDirectory()) {
      await copyMissingResources(from, to);
    } else if (entry.isFile()) {
      try {
        await copyFile(from, to, constants.COPYFILE_EXCL);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
          throw error;
        }
      }
    }
  }
}
