import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vite-plus/test';

import { copyMissingResources } from './resources.ts';

it('目标 models 已存在时补齐资源，重复迁移不覆盖文件', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ciel-migration-'));

  try {
    const source = join(root, 'old/models');
    const target = join(root, '.ciel/models');
    await mkdir(source, { recursive: true });
    await mkdir(target, { recursive: true });
    await writeFile(join(source, 'model.onnx'), 'new');
    await copyMissingResources(source, target);
    expect(await readFile(join(target, 'model.onnx'), 'utf8')).toBe('new');
    await writeFile(join(target, 'model.onnx'), 'existing');
    await copyMissingResources(source, target);
    expect(await readFile(join(target, 'model.onnx'), 'utf8')).toBe('existing');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
