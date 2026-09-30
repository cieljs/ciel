import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, expect, test } from 'vite-plus/test';

import { ProcessASR } from '../src/process-asr.ts';

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function worker(source: string) {
  const directory = await mkdtemp(join(tmpdir(), 'hearing-worker-'));
  directories.push(directory);
  const file = join(directory, 'worker.mjs');

  await writeFile(
    file,
    `import { createInterface } from 'node:readline';
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
for await (const line of createInterface({ input: process.stdin })) {
const command = JSON.parse(line);
${source}
}`,
  );

  return pathToFileURL(file);
}

test('自定义 VAD 窗口完整传入独立进程', async () => {
  const url = await worker(`
if (command.type === 'init') {
 const vad = command.options.vad;
 if (vad?.minSilenceDuration !== 0.8 || vad?.maxSpeechDuration !== 15) {
   send({ type: 'error', message: 'VAD options missing' });
   break;
 }
}
send({ type: 'ack', id: command.id });
if (command.type === 'close') break;`);

  const asr = new ProcessASR(
    { modelsPath: '/models', vad: { minSilenceDuration: 0.8, maxSpeechDuration: 15 } },
    'asr',
    url,
  );

  try {
    await asr.flush();
  } finally {
    await asr.close();
  }
});

test('flush 等待尾部结果，跨进程恢复事件时间，close 共享同一个 Promise', async () => {
  const url = await worker(`
if (command.type === 'flush') {
 await new Promise(resolve => setTimeout(resolve, 30));
 send({ type: 'result', data: { content: '', events: [{ type: 'applause' }], startAt: new Date(0), endAt: new Date(100) } });
 send({ type: 'wake', data: { keyword: '夏尔', at: new Date(50) } });
}
send({ type: 'ack', id: command.id });
if (command.type === 'close') break;`);

  const asr = new ProcessASR({ modelsPath: '/models' }, 'asr', url);
  const results: unknown[] = [];
  const wakes: unknown[] = [];
  asr.on('result', result => results.push(result));
  asr.on('wake', event => wakes.push(event));
  await asr.write({ data: Buffer.alloc(20), startAt: new Date(0) });
  await asr.flush();

  expect(results).toMatchObject([
    { content: '', events: [{ type: 'applause' }], startAt: new Date(0) },
  ]);

  expect(wakes).toEqual([{ keyword: '夏尔', at: new Date(50) }]);
  const closing = asr.close();
  expect(asr.close()).toBe(closing);
  await closing;
});

test('启动失败和意外退出拒绝请求，并能完成关闭', async () => {
  const url = await worker('process.exit(1);');
  const asr = new ProcessASR({ modelsPath: '/models' }, 'asr', url);
  await expect(asr.flush()).rejects.toThrow('exited');
  await expect(asr.close()).rejects.toThrow('exited');
});
