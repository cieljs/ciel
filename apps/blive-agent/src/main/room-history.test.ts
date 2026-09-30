import { describe, expect, it } from 'vite-plus/test';

import type { RoomCandidate, RoomInfo } from '../shared/types.ts';
import {
  excludeRevisits,
  ROOM_REVISIT_COOLDOWN_MS,
  RoomHistory,
  type RoomDeparture,
} from './room-history.ts';

const MINUTE = 60_000;

function candidate(roomId: number, streamerName = `主播${roomId}`): RoomCandidate {
  return {
    roomId,
    streamerUid: roomId * 10,
    streamerName,
    title: `${streamerName}的直播`,
    areaName: '聊天',
  };
}

function room(roomId: number, streamerName = `主播${roomId}`): RoomInfo {
  return {
    ...candidate(roomId, streamerName),
    description: '',
    parentAreaName: '娱乐',
    live: true,
  };
}

function departure(roomId: number, leftAt: number): RoomDeparture {
  return { roomId, streamerName: `主播${roomId}`, title: `主播${roomId}的直播`, leftAt };
}

describe('冷却登记', () => {
  it('只保留冷却期内的房间，最近离开的在前', () => {
    const history = new RoomHistory();
    const now = 1_000 * MINUTE;
    history.record(room(1), now - 5 * MINUTE);
    history.record(room(2), now - 40 * MINUTE);
    history.record(room(3), now - 12 * MINUTE);

    expect(history.cooling(now).map(item => item.roomId)).toEqual([1, 3]);
  });

  it('刚好 30 分钟不再算冷却，少一毫秒仍算', () => {
    const history = new RoomHistory();
    const now = 1_000 * MINUTE;
    history.record(room(1), now - ROOM_REVISIT_COOLDOWN_MS);
    history.record(room(2), now - ROOM_REVISIT_COOLDOWN_MS + 1);

    expect(history.cooling(now).map(item => item.roomId)).toEqual([2]);
  });

  it('同一房间再看一次以最近一次离开为准', () => {
    const history = new RoomHistory();
    const now = 1_000 * MINUTE;
    history.record(room(1), now - 20 * MINUTE);
    history.record(room(1), now - Number(MINUTE));

    expect(history.cooling(now)).toEqual([
      expect.objectContaining({ roomId: 1, leftAt: now - Number(MINUTE) }),
    ]);
  });
});

describe('候选冷却过滤', () => {
  const now = 1_000 * MINUTE;

  it('永远排除当前房间，即使它不在冷却里', () => {
    const result = excludeRevisits([candidate(1), candidate(2)], {
      currentRoomId: 1,
      cooling: [],
    });

    expect(result.candidates.map(item => item.roomId)).toEqual([2]);
    expect(result.cooled).toEqual([]);
    expect(result.relaxed).toBe(false);
  });

  it('冷却中的候选从列表移除，并按离开时间从早到晚报告', () => {
    const result = excludeRevisits([candidate(1), candidate(2), candidate(3), candidate(4)], {
      currentRoomId: 1,
      cooling: [departure(3, now - 2 * MINUTE), departure(2, now - 20 * MINUTE)],
    });

    expect(result.candidates.map(item => item.roomId)).toEqual([4]);
    expect(result.cooled.map(item => item.roomId)).toEqual([2, 3]);
    expect(result.relaxed).toBe(false);
  });

  it('冷却期外的房间留在候选里', () => {
    const result = excludeRevisits([candidate(1), candidate(2)], {
      cooling: [departure(9, now - Number(MINUTE))],
    });

    expect(result.candidates.map(item => item.roomId)).toEqual([1, 2]);
    expect(result.cooled).toEqual([]);
    expect(result.relaxed).toBe(false);
  });

  it('冷却会把候选清空时放宽，仍然排除当前房间', () => {
    const result = excludeRevisits([candidate(1), candidate(2)], {
      currentRoomId: 1,
      cooling: [departure(2, now - 3 * MINUTE)],
    });

    expect(result.candidates.map(item => item.roomId)).toEqual([2]);
    expect(result.cooled.map(item => item.roomId)).toEqual([2]);
    expect(result.relaxed).toBe(true);
  });

  it('只留下当前房间时不放宽，交给调用方报错', () => {
    const result = excludeRevisits([candidate(1)], { currentRoomId: 1, cooling: [] });

    expect(result.candidates).toEqual([]);
    expect(result.cooled).toEqual([]);
    expect(result.relaxed).toBe(false);
  });
});
