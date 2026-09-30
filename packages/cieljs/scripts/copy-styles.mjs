import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

for (const name of ['console', 'investigation']) {
  const target = join('dist', name, 'style.css');

  await mkdir(dirname(target), { recursive: true });
  await copyFile(join('..', name, 'dist', 'style.css'), target);
}
