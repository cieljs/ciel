import { expect, it, vi } from 'vite-plus/test';

import { BilibiliApi } from '../bilibili/api.ts';
import { createStreamerTools } from './streamer-tools.ts';

it('工具按需请求，默认主播随房间变化，显式 UID 可查询其他主播', async () => {
  const api = new BilibiliApi();
  const dynamics = vi.spyOn(api, 'streamerDynamics').mockResolvedValue([]);
  const videos = vi.spyOn(api, 'streamerVideos').mockResolvedValue([]);
  const readInPage = vi.fn();

  let room = {
    roomId: 1,
    streamerUid: 10,
    streamerName: '主播',
    title: '',
    description: '',
    parentAreaName: '',
    areaName: '',
    live: true,
  };

  const tools = createStreamerTools({ api, room: () => room, readInPage });
  expect(dynamics).not.toHaveBeenCalled();
  expect(videos).not.toHaveBeenCalled();
  const result = await tools[0]!.execute('call', {});
  expect(dynamics).toHaveBeenCalledWith(10, readInPage, 8);
  expect(result.details).toEqual({ uid: 10, source: 'public', items: [] });
  room = { ...room, streamerUid: 20 };
  await tools[1]!.execute('call2', {});
  expect(videos).toHaveBeenCalledWith(20, readInPage, 8);
  await tools[0]!.execute('call3', { uid: 30, limit: 2 });
  expect(dynamics).toHaveBeenLastCalledWith(30, readInPage, 2);
});

it('无当前主播、取消或查询失败时明确报错', async () => {
  const api = new BilibiliApi();
  const query = vi.spyOn(api, 'streamerDynamics').mockRejectedValue(new Error('API -403'));
  const tool = createStreamerTools({ api, room: () => undefined, readInPage: vi.fn() })[0]!;
  await expect(tool.execute('call', {})).rejects.toThrow('请显式提供 uid');
  const controller = new AbortController();
  controller.abort();
  await expect(tool.execute('call', { uid: 1 }, controller.signal)).rejects.toThrow();
  expect(query).not.toHaveBeenCalled();
  await expect(tool.execute('call', { uid: 1 })).rejects.toThrow('API -403');
});
