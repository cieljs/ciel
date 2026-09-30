import type { BilibiliApi } from './api.ts';
import type { LivePage } from './live-page.ts';
import type { LiveStatus } from './live-status-monitor.ts';

interface LiveStatusQuery {
  page: Pick<LivePage, 'liveStatus'>;
  api: Pick<BilibiliApi, 'room'>;
  roomId: number;
  signal: AbortSignal;
  reason: 'periodic' | 'media_exit';
}

/** 播放器离线先由 API 核实；媒体退出时直接查 API，避免播放器缓存仍显示直播中。 */
export async function readRoomLiveStatus(options: LiveStatusQuery): Promise<LiveStatus> {
  const { page, api, roomId, signal, reason } = options;
  signal.throwIfAborted();

  if (reason === 'periodic') {
    try {
      const status = await page.liveStatus(signal);
      signal.throwIfAborted();

      if (status === 'live') {
        return 'live';
      }
    } catch {
      signal.throwIfAborted();
      // 播放器未初始化或页面暂不可用时，改用服务端状态判断。
    }
  }

  const room = await api.room(roomId);
  signal.throwIfAborted();

  return room.live ? 'live' : 'offline';
}
