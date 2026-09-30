import { mkdtempSync, mkdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vite-plus/test';

import { loadVoiceprints } from './voiceprints.ts';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('按文件名读取声纹，并在下一次加载时反映新增、重命名和删除', () => {
  const root = mkdtempSync(join(tmpdir(), 'watch-voiceprints-'));
  directories.push(root);
  expect(loadVoiceprints(root)).toEqual([]);

  const directory = join(root, 'voiceprints');
  mkdirSync(directory);
  mkdirSync(join(directory, 'ignored.voiceprint'));
  writeFileSync(join(directory, 'notes.txt'), '');
  writeFileSync(join(directory, '弥生.voiceprint'), '');

  expect(loadVoiceprints(root)).toEqual([
    { name: '弥生', file: join(directory, '弥生.voiceprint') },
  ]);

  renameSync(join(directory, '弥生.voiceprint'), join(directory, '弥生.直播.voiceprint'));
  writeFileSync(join(directory, '夏尔.voiceprint'), '');

  expect(loadVoiceprints(root).map(profile => profile.name)).toEqual(
    expect.arrayContaining(['弥生.直播', '夏尔']),
  );

  unlinkSync(join(directory, '夏尔.voiceprint'));

  expect(loadVoiceprints(root)).toEqual([
    { name: '弥生.直播', file: join(directory, '弥生.直播.voiceprint') },
  ]);
});

it('路径不可作为目录读取时暴露错误', () => {
  const root = mkdtempSync(join(tmpdir(), 'watch-voiceprints-'));
  directories.push(root);
  writeFileSync(join(root, 'voiceprints'), '');
  expect(() => loadVoiceprints(root)).toThrow();
});
