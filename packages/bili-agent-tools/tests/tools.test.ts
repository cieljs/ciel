import { expect, test } from 'vite-plus/test';

import { createBiliAgentTools } from '../src/index.ts';
import { createFakeFetch, getTool, navResponse } from './fake-fetch.ts';

const SPACE_FEED = {
  code: 0,
  data: {
    has_more: true,
    offset: 'next-offset',
    items: [
      {
        id_str: '1063487284684259332',
        type: 'DYNAMIC_TYPE_DRAW',
        basic: { jump_url: '//www.bilibili.com/opus/1063487284684259332' },
        modules: {
          module_author: {
            mid: 2095498218,
            name: '次元壁小宋',
            pub_ts: 1746450829,
            pub_time: '27分钟前',
          },
          module_dynamic: {
            desc: { text: '今天的画' },
            major: {
              opus: {
                title: '置顶图集',
                summary: { text: '置顶图集' },
                pics: [
                  { url: 'http://i0.hdslb.com/bfs/new_dyn/a.png' },
                  { url: 'http://i0.hdslb.com/bfs/new_dyn/b.png' },
                ],
              },
            },
          },
          module_stat: { like: { count: 1 }, comment: { count: 2 }, forward: { count: 3 } },
          module_tag: { text: '置顶' },
        },
      },
      {
        id_str: '1062695803784527872',
        type: 'DYNAMIC_TYPE_AV',
        basic: { jump_url: '//www.bilibili.com/opus/1062695803784527872' },
        modules: {
          module_author: { mid: 2095498218, name: '次元壁小宋', pub_ts: 1746000000 },
          module_dynamic: {
            desc: { text: '新视频' },
            major: {
              archive: {
                bvid: 'BV1HUVnz7EX1',
                title: '来自阿洛娜的权威',
                cover: 'http://i1.hdslb.com/bfs/archive/a.jpg',
                desc: '-',
                duration_text: '05:14',
                stat: { play: 10, danmaku: 2 },
              },
            },
          },
          module_stat: { like: { count: 5 }, comment: { count: 6 }, forward: { count: 7 } },
        },
      },
    ],
  },
};

function feedFetch() {
  return createFakeFetch(url => (url.pathname.endsWith('/nav') ? navResponse() : SPACE_FEED));
}

test('get_bili_user_dynamics 归一化动态、翻页游标与签名参数', async () => {
  const { fetchImpl, calls } = feedFetch();
  const tools = createBiliAgentTools({ cookie: 'SESSDATA=abc', fetch: fetchImpl });

  const result = await getTool(tools, 'get_bili_user_dynamics').execute('call-1', {
    uid: 2095498218,
  });

  expect(result.details).toMatchObject({
    uid: 2095498218,
    nextOffset: 'next-offset',
    items: [
      {
        id: '1063487284684259332',
        type: 'DYNAMIC_TYPE_DRAW',
        isPinned: true,
        url: 'https://www.bilibili.com/opus/1063487284684259332',
        author: { uid: 2095498218, name: '次元壁小宋' },
        publishedAt: 1746450829,
        text: '今天的画\n置顶图集',
        images: ['http://i0.hdslb.com/bfs/new_dyn/a.png', 'http://i0.hdslb.com/bfs/new_dyn/b.png'],
        stats: { like: 1, comment: 2, forward: 3 },
      },
      {
        id: '1062695803784527872',
        isPinned: false,
        images: [],
        video: {
          bvid: 'BV1HUVnz7EX1',
          title: '来自阿洛娜的权威',
          duration: '05:14',
          play: 10,
          danmaku: 2,
          url: 'https://www.bilibili.com/video/BV1HUVnz7EX1',
        },
      },
    ],
  });

  const feedCall = calls.find(url => url.pathname.includes('feed/space'));

  expect(feedCall?.searchParams.get('host_mid')).toBe('2095498218');
  expect(feedCall?.searchParams.get('w_rid')).toBeTruthy();
  expect(feedCall?.searchParams.get('wts')).toBeTruthy();
});

// 取自浏览器实测响应：开播提醒动态、带「万」单位的播放量、字符串时间戳
test('get_bili_user_dynamics 归一化开播动态与带单位的统计值', async () => {
  const feed = {
    code: 0,
    data: {
      has_more: false,
      items: [
        {
          id_str: '1252661335437606920',
          type: 'DYNAMIC_TYPE_LIVE_RCMD',
          basic: { jump_url: '' },
          modules: {
            module_author: {
              mid: 194484313,
              name: 'Asaki大人',
              pub_ts: '1790496345',
              pub_time: '',
              pub_action: '直播了',
            },
            module_dynamic: {
              desc: null,
              major: {
                live_rcmd: {
                  content: JSON.stringify({
                    type: 1,
                    live_play_info: {
                      room_id: 6154037,
                      uid: 194484313,
                      live_status: 1,
                      title: '洛克王国！',
                      cover: 'https://i0.hdslb.com/bfs/live/new_room_cover/a.jpg',
                      online: 453383,
                      area_name: '洛克王国：世界',
                      parent_area_name: '手游',
                      live_start_time: 1790495741,
                      link: '//live.bilibili.com/6154037?live_from=85002',
                    },
                  }),
                },
              },
            },
            module_stat: { like: { count: 73 }, comment: { count: 0 }, forward: { count: 0 } },
            module_tag: null,
          },
        },
        {
          id_str: '1251113674025730133',
          type: 'DYNAMIC_TYPE_AV',
          basic: { jump_url: '' },
          modules: {
            module_author: {
              mid: 194484313,
              name: 'Asaki大人',
              pub_ts: '1790136002',
              pub_time: '9月23日',
              pub_action: '投稿了视频',
            },
            module_dynamic: {
              desc: { text: '再别说了！该不直播自己偷偷玩了！！！！' },
              major: {
                archive: {
                  bvid: 'BV1vG4k6EEC6',
                  title: '【GTA6】最火热的中文实机重磅来袭！',
                  cover: 'http://i2.hdslb.com/bfs/archive/a.jpg',
                  desc: '记得点赞投币！！！！谢谢宝宝们',
                  duration_text: '26:44',
                  jump_url: '//www.bilibili.com/video/BV1vG4k6EEC6',
                  stat: { play: '16.6万', danmaku: '206' },
                },
              },
            },
            module_stat: { like: { count: 5131 }, comment: { count: 456 }, forward: { count: 13 } },
            module_tag: null,
          },
        },
      ],
    },
  };

  const { fetchImpl } = createFakeFetch(url =>
    url.pathname.endsWith('/nav') ? navResponse() : feed,
  );

  const tools = createBiliAgentTools({ fetch: fetchImpl });

  const result = await getTool(tools, 'get_bili_user_dynamics').execute('call-1', {
    uid: 194484313,
  });

  expect(result.details).toMatchObject({
    items: [
      {
        type: 'DYNAMIC_TYPE_LIVE_RCMD',
        action: '直播了',
        publishedAt: 1790496345,
        url: 'https://www.bilibili.com/opus/1252661335437606920',
        live: {
          roomId: 6154037,
          title: '洛克王国！',
          liveStatus: 1,
          online: 453383,
          areaName: '洛克王国：世界',
          parentAreaName: '手游',
          url: 'https://live.bilibili.com/6154037',
        },
        stats: { like: 73, comment: 0, forward: 0 },
      },
      {
        type: 'DYNAMIC_TYPE_AV',
        action: '投稿了视频',
        publishedAt: 1790136002,
        text: '再别说了！该不直播自己偷偷玩了！！！！',
        url: 'https://www.bilibili.com/video/BV1vG4k6EEC6',
        video: {
          bvid: 'BV1vG4k6EEC6',
          play: 166000,
          danmaku: 206,
          url: 'https://www.bilibili.com/video/BV1vG4k6EEC6',
        },
      },
    ],
  });
});

test('get_bili_dynamic_detail 支持 opus 地址并返回完整正文', async () => {
  const detail = {
    code: 0,
    data: {
      item: {
        id_str: '1252647612996124681',
        type: 'DYNAMIC_TYPE_DRAW',
        basic: { jump_url: '//www.bilibili.com/opus/1252647612996124681' },
        modules: {
          module_author: {
            mid: 194484313,
            name: 'Asaki大人',
            pub_ts: '1790493150',
            pub_time: '2小时前',
          },
          module_dynamic: {
            desc: null,
            major: {
              opus: {
                title: '今天！',
                summary: { text: '又是勤奋的一天！\n八点鹅鸭杀！' },
                pics: [{ url: 'http://i0.hdslb.com/bfs/new_dyn/a.gif' }],
              },
            },
          },
          module_stat: { like: { count: 827 }, comment: { count: 351 }, forward: { count: 0 } },
          module_tag: null,
        },
      },
    },
  };

  const { fetchImpl, calls } = createFakeFetch(url =>
    url.pathname.endsWith('/nav') ? navResponse() : detail,
  );

  const tools = createBiliAgentTools({ fetch: fetchImpl });

  const result = await getTool(tools, 'get_bili_dynamic_detail').execute('call-1', {
    id: 'https://www.bilibili.com/opus/1252647612996124681?spm_id_from=333.1387.0.0',
  });

  expect(result.details).toMatchObject({
    id: '1252647612996124681',
    type: 'DYNAMIC_TYPE_DRAW',
    text: '今天！\n又是勤奋的一天！\n八点鹅鸭杀！',
    images: ['http://i0.hdslb.com/bfs/new_dyn/a.gif'],
    publishedAt: 1790493150,
    stats: { like: 827, comment: 351, forward: 0 },
  });

  const detailCall = calls.find(url => url.pathname.includes('/v1/detail'));

  expect(detailCall?.searchParams.get('id')).toBe('1252647612996124681');
});

test('get_bili_dynamic_detail 无法解析 id 时报错', async () => {
  const { fetchImpl } = createFakeFetch(() => navResponse());
  const tools = createBiliAgentTools({ fetch: fetchImpl });

  await expect(
    getTool(tools, 'get_bili_dynamic_detail').execute('call-1', { id: 'not-an-id' }),
  ).rejects.toThrow('无法从');
});

test('get_bili_pinned_dynamic 只返回置顶动态', async () => {
  const { fetchImpl } = feedFetch();
  const tools = createBiliAgentTools({ fetch: fetchImpl });

  const result = await getTool(tools, 'get_bili_pinned_dynamic').execute('call-1', { uid: 1 });

  expect(result.details).toMatchObject({
    uid: 1,
    dynamic: { id: '1063487284684259332', isPinned: true },
  });
});

test('get_bili_pinned_dynamic 在没有置顶动态时返回 null', async () => {
  const { fetchImpl } = createFakeFetch(url =>
    url.pathname.endsWith('/nav')
      ? navResponse()
      : { code: 0, data: { has_more: false, items: [] } },
  );

  const tools = createBiliAgentTools({ fetch: fetchImpl });

  const result = await getTool(tools, 'get_bili_pinned_dynamic').execute('call-1', { uid: 1 });

  expect(result.details).toMatchObject({ uid: 1, dynamic: null });
});

test('签名被拒时刷新 WBI 口令并重试', async () => {
  let navCalls = 0;
  let feedCalls = 0;

  const { fetchImpl } = createFakeFetch(url => {
    if (url.pathname.endsWith('/nav')) {
      navCalls += 1;

      return navResponse();
    }

    feedCalls += 1;

    return feedCalls === 1 ? { code: 0, data: { v_voucher: 'voucher_xxx' } } : SPACE_FEED;
  });

  const tools = createBiliAgentTools({ fetch: fetchImpl });

  const result = await getTool(tools, 'get_bili_user_dynamics').execute('call-1', { uid: 1 });

  expect(navCalls).toBe(2);
  expect(feedCalls).toBe(2);
  expect(result.details).toMatchObject({ uid: 1 });
});

test('get_bili_user_submissions 支持视频投稿', async () => {
  const { fetchImpl, calls } = createFakeFetch(url => {
    if (url.pathname.endsWith('/nav')) {
      return navResponse();
    }

    return {
      code: 0,
      data: {
        list: {
          vlist: [
            {
              aid: 78977417,
              bvid: 'BV1KJ411C7Un',
              title: '初音未来',
              description: '简介',
              pic: 'http://i1.hdslb.com/bfs/archive/a.jpg',
              length: '04:02',
              created: 1579877678,
              play: 2915520,
              video_review: 14572,
              comment: 6124,
            },
          ],
        },
        page: { count: 1, pn: 1, ps: 20 },
      },
    };
  });

  const tools = createBiliAgentTools({ fetch: fetchImpl });

  const result = await getTool(tools, 'get_bili_user_submissions').execute('call-1', {
    uid: 300021061,
  });

  expect(result.details).toMatchObject({
    uid: 300021061,
    type: 'video',
    page: 1,
    limit: 10,
    total: 1,
    items: [
      {
        bvid: 'BV1KJ411C7Un',
        title: '初音未来',
        duration: '04:02',
        publishedAt: 1579877678,
        play: 2915520,
        danmaku: 14572,
        comment: 6124,
        url: 'https://www.bilibili.com/video/BV1KJ411C7Un',
      },
    ],
  });

  const listCall = calls.find(url => url.pathname.includes('arc/search'));

  expect(listCall?.searchParams.get('mid')).toBe('300021061');
  expect(listCall?.searchParams.get('order')).toBe('pubdate');
  expect(listCall?.searchParams.get('w_rid')).toBeTruthy();
});

test('get_bili_user_submissions 支持专栏图文投稿', async () => {
  const { fetchImpl, calls } = createFakeFetch(url => {
    if (url.pathname.endsWith('/nav')) {
      return navResponse();
    }

    return {
      code: 0,
      data: {
        articles: [
          {
            id: 4743576,
            title: '普通DISCO 神话达成',
            summary: '摘要',
            banner_url: 'http://i0.hdslb.com/bfs/article/a.png',
            publish_time: 1582123245,
            words: 100,
            stats: { view: 843, favorite: 12, like: 113, reply: 58 },
          },
        ],
        count: 1,
      },
    };
  });

  const tools = createBiliAgentTools({ fetch: fetchImpl });

  const result = await getTool(tools, 'get_bili_user_submissions').execute('call-1', {
    uid: 295535204,
    type: 'article',
    order: 'view',
  });

  expect(result.details).toMatchObject({
    uid: 295535204,
    type: 'article',
    total: 1,
    items: [
      {
        id: 4743576,
        title: '普通DISCO 神话达成',
        view: 843,
        favorite: 12,
        like: 113,
        reply: 58,
        url: 'https://www.bilibili.com/read/cv4743576',
      },
    ],
  });

  const listCall = calls.find(url => url.pathname.includes('space/wbi/article'));

  expect(listCall?.searchParams.get('sort')).toBe('view');
});

test('get_bili_live_room 按 roomId 查询直播间信息', async () => {
  const { fetchImpl, calls } = createFakeFetch(url => {
    if (url.pathname.endsWith('/nav')) {
      return navResponse();
    }

    return {
      code: 0,
      data: {
        uid: 322892,
        room_id: 5441,
        short_id: 5441,
        title: '好久没当黑铁主播了',
        description: '简介',
        live_status: 1,
        live_time: '2024-05-05 19:08:46',
        online: 268602,
        attention: 317864,
        area_name: '我的世界',
        parent_area_name: '游戏',
        tags: 'minecraft,声控',
        user_cover: '//i0.hdslb.com/bfs/live/a.jpg',
        keyframe: '//i0.hdslb.com/bfs/live/b.jpg',
      },
    };
  });

  const tools = createBiliAgentTools({ fetch: fetchImpl });

  const result = await getTool(tools, 'get_bili_live_room').execute('call-1', { roomId: 5441 });

  expect(result.details).toMatchObject({
    roomId: 5441,
    uid: 322892,
    liveStatus: 1,
    liveStatusText: '直播中',
    online: 268602,
    tags: ['minecraft', '声控'],
    cover: 'https://i0.hdslb.com/bfs/live/a.jpg',
    url: 'https://live.bilibili.com/5441',
  });

  expect(calls.some(url => url.pathname.endsWith('/get_info'))).toBe(true);
});

test('get_bili_live_room 支持用 uid 反查直播间', async () => {
  const { fetchImpl, calls } = createFakeFetch(url => {
    if (url.pathname.endsWith('/nav')) {
      return navResponse();
    }

    if (url.pathname.endsWith('/getRoomInfoOld')) {
      return { code: 0, data: { roomid: 5441, roomStatus: 1 } };
    }

    return { code: 0, data: { uid: 322892, room_id: 5441, live_status: 0 } };
  });

  const tools = createBiliAgentTools({ fetch: fetchImpl });

  const result = await getTool(tools, 'get_bili_live_room').execute('call-1', { uid: 322892 });

  expect(result.details).toMatchObject({ roomId: 5441, liveStatusText: '未开播' });
  expect(calls.some(url => url.pathname.endsWith('/getRoomInfoOld'))).toBe(true);
});

test('get_bili_live_room 缺少 roomId 与 uid 时报错', async () => {
  const { fetchImpl } = createFakeFetch(() => navResponse());
  const tools = createBiliAgentTools({ fetch: fetchImpl });

  await expect(getTool(tools, 'get_bili_live_room').execute('call-1', {})).rejects.toThrow(
    '需要提供 roomId 或 uid',
  );
});

test('search_bili 去掉标题高亮标签并归一化视频结果', async () => {
  const { fetchImpl, calls } = createFakeFetch(url => {
    if (url.pathname.endsWith('/nav')) {
      return navResponse();
    }

    return {
      code: 0,
      data: {
        numResults: 1000,
        result: [
          {
            type: 'video',
            bvid: 'BV1KJ411C7Un',
            aid: 78977417,
            title: '初音未来《<em class="keyword">买买买</em>》',
            author: 'MitchieM',
            mid: 5669526,
            description: '简介',
            pic: '//i1.hdslb.com/bfs/archive/a.jpg',
            duration: '4:2',
            pubdate: 1579877678,
            play: 2915520,
            video_review: 14572,
            review: 6124,
            tag: '买买买,初音未来',
          },
        ],
      },
    };
  });

  const tools = createBiliAgentTools({ fetch: fetchImpl });

  const result = await getTool(tools, 'search_bili').execute('call-1', {
    keyword: '买买买',
  });

  expect(result.details).toMatchObject({
    keyword: '买买买',
    type: 'video',
    page: 1,
    total: 1000,
    items: [
      {
        bvid: 'BV1KJ411C7Un',
        title: '初音未来《买买买》',
        author: 'MitchieM',
        uid: 5669526,
        cover: 'https://i1.hdslb.com/bfs/archive/a.jpg',
        tags: ['买买买', '初音未来'],
        url: 'https://www.bilibili.com/video/BV1KJ411C7Un',
      },
    ],
  });

  const searchCall = calls.find(url => url.pathname.includes('search/type'));

  expect(searchCall?.searchParams.get('search_type')).toBe('video');
  expect(searchCall?.searchParams.get('keyword')).toBe('买买买');
  expect(searchCall?.searchParams.get('w_rid')).toBeTruthy();
});

test('search_bili 支持搜索主播', async () => {
  const { fetchImpl, calls } = createFakeFetch(url => {
    if (url.pathname.endsWith('/nav')) {
      return navResponse();
    }

    return {
      code: 0,
      data: {
        numResults: 1,
        result: [
          {
            type: 'bili_user',
            mid: 208259,
            uname: '<em class="keyword">痒局长</em>',
            usign: '签名',
            fans: 2570790,
            videos: 100,
            level: 6,
            upic: '//i2.hdslb.com/bfs/face/a.jpg',
            is_live: 1,
            room_id: 5441,
            official_verify: { type: 0, desc: 'bilibili 知名UP主' },
          },
        ],
      },
    };
  });

  const tools = createBiliAgentTools({ fetch: fetchImpl });

  const result = await getTool(tools, 'search_bili').execute('call-1', {
    keyword: '痒局长',
    type: 'bili_user',
  });

  expect(result.details).toMatchObject({
    type: 'bili_user',
    items: [
      {
        uid: 208259,
        name: '痒局长',
        fans: 2570790,
        isLive: true,
        roomId: 5441,
        verified: 'bilibili 知名UP主',
        url: 'https://space.bilibili.com/208259',
      },
    ],
  });

  const searchCall = calls.find(url => url.pathname.includes('search/type'));

  expect(searchCall?.searchParams.get('search_type')).toBe('bili_user');
});

test('接口返回非 0 code 时抛出 BiliApiError', async () => {
  const { fetchImpl } = createFakeFetch(url =>
    url.pathname.endsWith('/nav') ? navResponse() : { code: -404, message: '啥都木有' },
  );

  const tools = createBiliAgentTools({ fetch: fetchImpl });

  await expect(
    getTool(tools, 'get_bili_user_dynamics').execute('call-1', { uid: 1 }),
  ).rejects.toThrow('啥都木有');
});
