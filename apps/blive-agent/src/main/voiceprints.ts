import { readdirSync } from 'node:fs';
import { join, parse } from 'node:path';

import type { SpeakerProfile } from 'cieljs/hearing';

/** 每次创建感知时重新扫描，文件名就是识别结果中的说话人名称。 */
export function loadVoiceprints(dataDir: string): SpeakerProfile[] {
  const directory = join(dataDir, 'voiceprints');
  let entries;

  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  return entries
    .filter(entry => entry.isFile() && parse(entry.name).ext.toLowerCase() === '.voiceprint')
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(entry => ({ name: parse(entry.name).name, file: join(directory, entry.name) }));
}
