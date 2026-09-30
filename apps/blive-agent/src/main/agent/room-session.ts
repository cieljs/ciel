import type { RoomInfo, WatchMode } from '../../shared/types.ts';
import { createRoomSources } from '../prompts/index.ts';

const watchDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function createRoomSessionOptions(room: RoomInfo, enteredAt: Date, mode?: WatchMode) {
  const spaceId = `bilibili:room:${room.roomId}`;
  const date = mode?.type === 'recording' && mode.date ? mode.date : watchDate.format(enteredAt);

  const sessionId =
    mode?.type === 'recording' ? `${spaceId}:recording:${date}` : `${spaceId}:${date}`;

  // 以进入房间时的上海日期分会话；同日重访恢复历史，机器时区不影响身份。
  return {
    spaceId,
    sessionId,
    crossSpace: true,
    sources: createRoomSources(room),
  };
}
