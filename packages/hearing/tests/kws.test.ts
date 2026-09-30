import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test, vi } from 'vite-plus/test';

const result = vi.hoisted(() => ({
  keyword: '夏尔',
  start_time: 1,
  timestamps: [0.25],
  tokens: [],
}));

vi.mock('sherpa-onnx-node', () => ({
  default: {
    KeywordSpotter: class {
      ready = false;
      createStream() {
        return {
          acceptWaveform: () => {
            this.ready = true;
          },
          inputFinished() {},
        };
      }
      isReady() {
        return this.ready;
      }
      decode() {
        this.ready = false;
      }
      getResult() {
        return result;
      }
      reset() {}
    },
  },
}));

import { KWS, keywordTokens } from '../src/kws.ts';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('中文唤醒词转换为模型声母韵母 token', () => {
  expect(keywordTokens('法国')).toEqual(['f', 'ǎ', 'g', 'uó']);
  expect(keywordTokens('女儿')).toEqual(['n', 'ǚ', 'ér']);
});

test('独立 wake 事件映射时间，冷却期抑制重复命中并支持取消订阅', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hearing-kws-'));
  directories.push(directory);

  for (const name of ['encoder', 'decoder', 'joiner']) {
    writeFileSync(join(directory, `${name}-epoch-12-avg-2-chunk-16-left-64.onnx`), 'test');
  }

  writeFileSync(join(directory, 'tokens.txt'), 'x 1\nià 2\něr 3\n');
  const kws = new KWS({ modelsPath: directory, keywords: ['夏尔'], modelPath: directory });
  const listener = vi.fn();
  const unsubscribe = kws.on('wake', listener);
  await kws.write({ data: Buffer.alloc(6_400), startAt: new Date(10_000) });
  expect(listener).toHaveBeenCalledExactlyOnceWith({ keyword: '夏尔', at: new Date(11_250) });
  unsubscribe();
  await kws.close();
  expect(listener).toHaveBeenCalledTimes(1);
});
