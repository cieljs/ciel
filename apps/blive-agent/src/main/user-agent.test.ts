import { expect, it } from 'vite-plus/test';

import { browserUserAgent } from './user-agent.ts';

it('User-Agent 不暴露 Electron 与产品名，且保留真实 Chrome 形式', () => {
  expect(browserUserAgent).not.toContain('Electron');
  expect(browserUserAgent).not.toContain('blive-agent');

  expect(browserUserAgent).toMatch(
    /^Mozilla\/5\.0 \(.+\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/u,
  );
});
