import { expect, it, vi } from 'vite-plus/test';

import { readRoomLiveStatus } from './live-status.ts';

function setup() {
  return {
    page: { liveStatus: vi.fn().mockResolvedValue('live') },
    api: { room: vi.fn().mockResolvedValue({ live: false }) },
    roomId: 123,
    signal: new AbortController().signal,
  };
}

it('播放器未初始化时用 API 判断下播', async () => {
  const options = setup();
  options.page.liveStatus.mockResolvedValue(null);
  await expect(readRoomLiveStatus({ ...options, reason: 'periodic' })).resolves.toBe('offline');
  expect(options.api.room).toHaveBeenCalledWith(123);
});

it('页面短暂显示离线但 API 仍直播时不判下播', async () => {
  const options = setup();
  options.page.liveStatus.mockResolvedValue('offline');
  options.api.room.mockResolvedValue({ live: true });
  await expect(readRoomLiveStatus({ ...options, reason: 'periodic' })).resolves.toBe('live');
});

it('媒体退出时忽略播放器仍直播的缓存，直接由 API 核实', async () => {
  const options = setup();
  await expect(readRoomLiveStatus({ ...options, reason: 'media_exit' })).resolves.toBe('offline');
  expect(options.page.liveStatus).not.toHaveBeenCalled();
});

it('页面和 API 都失败时抛出查询错误，不伪造下播', async () => {
  const options = setup();
  options.page.liveStatus.mockRejectedValue(new Error('页面关闭'));
  options.api.room.mockRejectedValue(new Error('API 超时'));
  await expect(readRoomLiveStatus({ ...options, reason: 'periodic' })).rejects.toThrow('API 超时');
});
