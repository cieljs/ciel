import type { Ciel } from 'cieljs';
import { describe, expect, it, vi } from 'vite-plus/test';

import type { RoomCandidate, RoomInfo, WatchEvent } from '../../shared/types.ts';
import type { BilibiliApi } from '../bilibili/api.ts';
import type { PreviousVisit } from '../prompts/index.ts';
import type { RoomDeparture } from '../room-history.ts';
import { selectExplorationRoom } from './exploration.ts';

function candidate(roomId: number): RoomCandidate {
  return {
    roomId,
    streamerUid: roomId * 10,
    streamerName: `主播${roomId}`,
    title: `主播${roomId}的直播`,
    areaName: '聊天',
  };
}

function roomInfo(roomId: number): RoomInfo {
  return {
    ...candidate(roomId),
    description: '',
    parentAreaName: '娱乐',
    live: true,
  };
}

/** 冷却还没过期的登记，用于构造「刚看过」的候选。 */
function departure(roomId: number): RoomDeparture {
  const { streamerName, title } = candidate(roomId);

  return { roomId, streamerName, title, leftAt: Date.now() - 60_000 };
}

function setup(candidates: RoomCandidate[], answer: unknown) {
  const investigate = vi.fn().mockResolvedValue({
    answer: {
      role: 'assistant',
      content: [{ type: 'text', text: JSON.stringify(answer) }],
    },
  });

  const rooms = vi.fn().mockResolvedValue(candidates);
  const room = vi.fn(async (roomId: number) => roomInfo(roomId));
  const events: WatchEvent[] = [];

  return {
    investigate,
    rooms,
    room,
    events,
    question: () => investigate.mock.calls[0]![0].question as string,
    select: (extra: { previous?: PreviousVisit; cooling?: RoomDeparture[] }) =>
      selectExplorationRoom({
        areaId: 1,
        signal: new AbortController().signal,
        ciel: { investigate } as unknown as Ciel,
        api: { rooms, room } as unknown as BilibiliApi,
        emit: event => events.push(event),
        ...extra,
      }),
  };
}

describe('探索选房', () => {
  it('模型选回被冷却排除的房间时归属校验拒绝，不发事件也不开房', async () => {
    const context = setup([candidate(789), candidate(999)], { roomId: 789, reason: '还是这个好' });

    await expect(context.select({ cooling: [departure(789)] })).rejects.toThrow(
      'Agent 选择的直播间 789 不在本轮候选中',
    );

    expect(context.events).toEqual([]);
    expect(context.room).not.toHaveBeenCalled();
    expect(context.question()).toContain('"roomId":999');
  });

  it('刚离开的房间也选不回来', async () => {
    const context = setup([candidate(123), candidate(789)], { roomId: 123, reason: '还是这个好' });

    await expect(
      context.select({
        previous: {
          room: roomInfo(123),
          watchedSeconds: 90,
          reason: '宿主评分判定继续观看价值不足',
        },
        cooling: [],
      }),
    ).rejects.toThrow('不在本轮候选中');

    expect(context.question()).toContain('"roomId":789');
  });

  it('唯一的候选就是刚离开的房间时报错，宁可报错也不重进', async () => {
    const context = setup([candidate(123)], { roomId: 123, reason: '还是这个好' });

    await expect(
      context.select({
        previous: {
          room: roomInfo(123),
          watchedSeconds: 90,
          reason: '宿主评分判定继续观看价值不足',
        },
        cooling: [],
      }),
    ).rejects.toThrow('分区 1 当前没有其他直播候选');

    expect(context.room).not.toHaveBeenCalled();
  });

  it('放宽也留不下候选时报错点名冷却', async () => {
    const context = setup([candidate(123)], { roomId: 123, reason: '还是这个好' });

    await expect(
      context.select({
        previous: {
          room: roomInfo(123),
          watchedSeconds: 90,
          reason: '宿主评分判定继续观看价值不足',
        },
        cooling: [departure(123)],
      }),
    ).rejects.toThrow('分区 1 的直播候选都在冷却期内');
  });

  it('没有任何候选时沿用原错误', async () => {
    const context = setup([], { roomId: 789, reason: '看看新内容' });

    await expect(context.select({ cooling: [] })).rejects.toThrow('分区 1 当前没有直播候选');
  });

  it('选到有效房间时发出选择事件并返回房间信息', async () => {
    const context = setup([candidate(789)], { roomId: 789, reason: '唱歌' });

    const room = await context.select({ cooling: [] });

    expect(room.roomId).toBe(789);
    expect(context.events).toEqual([{ type: 'room_selected', roomId: 789, reason: '唱歌' }]);
  });
});
