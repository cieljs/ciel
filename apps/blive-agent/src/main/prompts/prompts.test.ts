import { describe, expect, it } from 'vite-plus/test';

import { createCandidateSources, createRoomSources } from '../prompts';

describe('直播来源', () => {
  it('房间 Session 同时包含房间和主播来源', () => {
    expect(
      createRoomSources({
        roomId: 100,
        streamerUid: 200,
        streamerName: '主播 名',
        title: '测试',
        description: '',
        parentAreaName: '娱乐',
        areaName: '聊天',
        live: true,
      }),
    ).toEqual([
      'bilibili:room:100',
      'bilibili:streamer:200',
      'bilibili:streamer-name:%E4%B8%BB%E6%92%AD%20%E5%90%8D',
    ]);
  });

  it('探索来源只标识分区，不随候选数量膨胀', () => {
    const sources = createCandidateSources(1, [
      {
        roomId: 100,
        streamerUid: 200,
        streamerName: '测试主播',
        title: '测试',
        areaName: '聊天',
      },
    ]);

    expect(sources).toEqual(['bilibili:area:1']);
  });
});
