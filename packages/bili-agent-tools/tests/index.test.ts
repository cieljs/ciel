import { expect, test, vi } from 'vite-plus/test';

import { createBiliAgentTools, createBiliClient } from '../src/index.ts';

test('createBiliAgentTools 返回全部工具', () => {
  const names = createBiliAgentTools().map(tool => tool.name);

  expect(names.sort()).toEqual([
    'get_bili_dynamic_detail',
    'get_bili_live_room',
    'get_bili_pinned_dynamic',
    'get_bili_user_dynamics',
    'get_bili_user_submissions',
    'search_bili',
  ]);
});

test('自定义 fetch 请求携带 credentials 以复用 Electron session Cookie', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: {} })));
  const client = createBiliClient({ fetch });

  await client.request('https://api.bilibili.com/x/web-interface/nav');

  expect(fetch).toHaveBeenCalledWith(
    'https://api.bilibili.com/x/web-interface/nav',
    expect.objectContaining({ credentials: 'include' }),
  );
});
