import { describe, expect, it, vi } from 'vite-plus/test';

import { BilibiliApi } from './api.ts';

describe('直播分区查询', () => {
  it('主播动态使用指定参数并经由页面请求', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const readInPage = vi.fn().mockResolvedValue({ code: 0, data: { items: [] } });
    await new BilibiliApi({ fetch }).streamerDynamics(194484313, readInPage);
    const url = new URL(readInPage.mock.calls[0]![0]);
    expect(url.pathname).toBe('/x/polymer/web-dynamic/v1/feed/space');

    expect(Object.fromEntries(url.searchParams)).toEqual({
      host_mid: '194484313',
      offset: '',
      timezone_offset: '-480',
      platform: 'web',
      features: 'itemOpusStyle',
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(readInPage).toHaveBeenCalledOnce();
  });

  it.each([
    [1, '1', '0'],
    [21, '1', '21'],
  ])('分区 %i 使用正确的父子参数', async (id, parentId, childId) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          data: { data: [{ id: 1, name: '娱乐', list: [{ id: '21', name: '日常' }] }] },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ code: 0, data: { list: [{ roomid: 123, uid: 456, title: '聊天' }] } }),
      );

    const api = new BilibiliApi({ fetch });
    const rooms = await api.rooms(id);
    const input = fetch.mock.calls[1]![0];
    const url = new URL(input instanceof Request ? input.url : input);
    expect(url.searchParams.get('parent_area_id')).toBe(parentId);
    expect(url.searchParams.get('area_id')).toBe(childId);
    expect(rooms[0]?.roomId).toBe(123);
  });

  it('API 错误不能伪装成空候选', async () => {
    const api = new BilibiliApi({
      fetch: vi.fn().mockResolvedValue(Response.json({ code: -403, message: '拒绝访问' })),
    });

    await expect(api.rooms(1)).rejects.toThrow('-403');
  });
});

describe('主播近期公开信息', () => {
  it('投稿请求不查询动态，失败不会伪装为空列表', async () => {
    const readInPage = vi.fn().mockResolvedValue({ code: -403, message: '拒绝访问' });
    const api = new BilibiliApi();
    await expect(api.streamerVideos(456, readInPage, 3)).rejects.toThrow('-403');
    expect(readInPage).toHaveBeenCalledOnce();
    const url = new URL(readInPage.mock.calls[0]![0]);
    expect(url.pathname).toBe('/x/space/arc/search');
    expect(url.searchParams.get('ps')).toBe('3');
  });

  it('动态置顶优先，并从动态卡片提取投稿标题列表', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          data: {
            items: [
              {
                id_str: 'normal',
                modules: { module_dynamic: { desc: { text: '普通动态' } } },
              },
              {
                id_str: 'video',
                modules: {
                  module_author: { pub_ts: 123 },
                  module_dynamic: {
                    major: { archive: { bvid: 'BV1xx', title: '动态里的投稿' } },
                  },
                  module_tag: { text: '置顶' },
                },
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          data: { list: { vlist: [{ bvid: 'BV2xx', title: '近期投稿', created: 456 }] } },
        }),
      );

    const api = new BilibiliApi({ fetch });

    const dynamics = await api.streamerDynamics(456);
    expect(fetch).toHaveBeenCalledOnce();
    const videos = await api.streamerVideos(456);

    expect(dynamics.map(item => item.title)).toEqual(['动态里的投稿', '普通动态']);
    expect(dynamics[0]?.url).toBe('https://t.bilibili.com/video');

    expect(videos).toEqual([
      expect.objectContaining({ id: 'BV2xx', title: '近期投稿', publishedAt: 456 }),
    ]);
  });
});
