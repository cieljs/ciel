import { describe, expect, it } from 'vite-plus/test';

import { createRoomSessionOptions } from './room-session.ts';

const room = {
  roomId: 123,
  streamerUid: 456,
  streamerName: '测试主播',
  title: '聊天',
  description: '',
  parentAreaName: '娱乐',
  areaName: '聊天',
  live: true,
};

describe('房间身份', () => {
  it('上海午夜只改变 Session，Space 不含日期或账号', () => {
    const before = createRoomSessionOptions(room, new Date('2026-09-06T15:59:59Z'));
    const after = createRoomSessionOptions(room, new Date('2026-09-06T16:00:00Z'));

    expect(before.spaceId).toBe('bilibili:room:123');
    expect(after.spaceId).toBe(before.spaceId);
    expect(before.sessionId).toBe('bilibili:room:123:2026-09-06');
    expect(after.sessionId).toBe('bilibili:room:123:2026-09-07');
    expect(after.crossSpace).toBe(true);
    expect(after.sources.some(source => source.includes('account'))).toBe(false);
  });

  it('同日重访恢复同一身份，不同房间使用不同 Space 和 Session', () => {
    const first = createRoomSessionOptions(room, new Date('2026-09-06T01:00:00Z'));
    const revisit = createRoomSessionOptions(room, new Date('2026-09-06T02:00:00Z'));

    const other = createRoomSessionOptions(
      { ...room, roomId: 789 },
      new Date('2026-09-06T02:00:00Z'),
    );

    expect(revisit).toEqual(first);
    expect(other.spaceId).not.toBe(first.spaceId);
    expect(other.sessionId).not.toBe(first.sessionId);
  });

  it('录播复用房间 Space，但使用独立 Session 并支持指定日期', () => {
    const automatic = createRoomSessionOptions(room, new Date('2026-09-06T16:00:00Z'), {
      type: 'recording',
      roomId: 123,
      source: { type: 'url', url: 'https://example.com/video.mp4' },
    });

    const specified = createRoomSessionOptions(room, new Date('2026-09-06T16:00:00Z'), {
      type: 'recording',
      roomId: 123,
      source: { type: 'file', path: 'C:\\Videos\\recording.mp4' },
      date: '2026-08-01',
    });

    expect(automatic.spaceId).toBe('bilibili:room:123');
    expect(automatic.sessionId).toBe('bilibili:room:123:recording:2026-09-07');
    expect(specified.sessionId).toBe('bilibili:room:123:recording:2026-08-01');
  });
});
