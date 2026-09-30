import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { expect, it } from 'vite-plus/test';

// 运行实际安装的补丁代码，隔离 native addon，覆盖同步和异步解析入口。
it('原生 JSON 中的换行、制表符保持原文，其他 JSON 错误仍抛出', async () => {
  let raw = '{"text":"第一行\n第二行\t结束","tokens":["\u0001"],"timestamps":[]}';

  const module = {
    exports: {} as {
      OfflineRecognizer: new (config: object) => {
        getResult(stream: { handle: object }): { text: string; tokens: string[] };
        decodeAsync(stream: { handle: object }): Promise<unknown>;
      };
    },
  };

  const require = createRequire(import.meta.url);
  const file = join(dirname(require.resolve('sherpa-onnx-node')), 'non-streaming-asr.js');

  runInNewContext(readFileSync(file, 'utf8'), {
    module,
    require: () => ({
      createOfflineRecognizer: () => ({}),
      getOfflineStreamResultAsJson: () => raw,
      decodeOfflineStreamAsync: async () => raw,
    }),
  });

  const recognizer = new module.exports.OfflineRecognizer({});
  const stream = { handle: {} };

  expect(recognizer.getResult(stream)).toMatchObject({
    text: '第一行\n第二行\t结束',
    tokens: ['\u0001'],
  });

  await expect(recognizer.decodeAsync(stream)).resolves.toMatchObject({
    text: '第一行\n第二行\t结束',
  });

  raw = JSON.stringify({ text: '引号"、反斜杠\\和字面量\\n' });
  expect(recognizer.getResult(stream).text).toBe('引号"、反斜杠\\和字面量\\n');
  raw = '{"text": invalid}';
  expect(() => recognizer.getResult(stream)).toThrow();
});
