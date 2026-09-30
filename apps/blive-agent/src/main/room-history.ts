import type { RoomCandidate, RoomInfo } from '../shared/types.ts';

/** 刚离开的房间在这段时间内不再进入候选；宿主硬性保证，模型只是被额外告知。 */
export const ROOM_REVISIT_COOLDOWN_MS = 30 * 60_000;

/** 一次已结束的观看；只留冷却判断与提示词需要的字段。 */
export interface RoomDeparture {
  roomId: number;
  streamerName: string;
  title: string;
  /** 离开时刻，用来算剩余冷却与「谁最久没看过」。 */
  leftAt: number;
}

/**
 * 进程内的冷却登记。宿主只在内存里记住最近看过哪些房间，
 * 不落盘：30 分钟窗口基本落在一次运行内，跨重启保留不值得一次持久化。
 */
export class RoomHistory {
  private readonly departures = new Map<number, RoomDeparture>();

  /** 同一房间再看一次就覆盖前一条，以最近一次离开为准。 */
  record(room: RoomInfo, leftAt = Date.now()): void {
    this.departures.set(room.roomId, {
      roomId: room.roomId,
      streamerName: room.streamerName,
      title: room.title,
      leftAt,
    });
  }

  /** 仍在冷却期内的房间，最近离开的在前；顺带丢掉已过期的登记，免得长期运行只增不减。 */
  cooling(now = Date.now()): RoomDeparture[] {
    const alive: RoomDeparture[] = [];

    for (const [roomId, departure] of this.departures) {
      if (now - departure.leftAt >= ROOM_REVISIT_COOLDOWN_MS) {
        this.departures.delete(roomId);
      } else {
        alive.push(departure);
      }
    }

    return alive.sort((a, b) => b.leftAt - a.leftAt);
  }
}

/**
 * 决定本轮真正交给模型的候选，以及被冷却挡掉的那些。
 *
 * 放宽规则：冷却不能让候选变空——真出现这种情况就忽略冷却（仍然排除当前房间），
 * 只按离开时间从早到晚把最近看过的房间排回去。小分区里宁可回到旧房间，
 * 也好过探索模式周期性地刷错误。
 */
export function excludeRevisits(
  candidates: readonly RoomCandidate[],
  options: { currentRoomId?: number; cooling: readonly RoomDeparture[] },
): {
  /** 交给模型的候选，保持 API 返回的顺序。 */
  candidates: RoomCandidate[];
  /** 本轮候选里仍在冷却期内的房间，最久没看的在前；放宽时它们也在上面的候选里。 */
  cooled: RoomDeparture[];
  /** 冷却原本会把候选清空，已放宽。 */
  relaxed: boolean;
} {
  const { currentRoomId, cooling } = options;
  const departed = new Map(cooling.map(item => [item.roomId, item]));

  const cooled = candidates
    .flatMap(item => departed.get(item.roomId) ?? [])
    .sort((a, b) => a.leftAt - b.leftAt);

  const available = candidates.filter(
    item => item.roomId !== currentRoomId && !departed.has(item.roomId),
  );

  if (available.length > 0 || cooled.length === 0) {
    return { candidates: available, cooled, relaxed: false };
  }

  return {
    candidates: candidates.filter(item => item.roomId !== currentRoomId),
    cooled,
    relaxed: true,
  };
}
