import { styleText } from 'node:util';

export function progress(current: number, total: number, width = 30): void {
  const ratio = total > 0 ? Math.min(1, current / total) : 0;
  const filled = Math.round(ratio * width);
  const percent = Math.round(ratio * 100);
  const percentText = `${percent}%`.padStart(4);

  process.stdout.write(
    `\r${styleText('cyan', '━'.repeat(filled))}${styleText(
      'gray',
      '━'.repeat(width - filled),
    )} ${percentText}`,
  );

  if (current >= total) {
    process.stdout.write('\n');
  }
}
