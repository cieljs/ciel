import { defineTool, prompt } from '@cieljs/agent-kit';
import { Type } from 'typebox';

import type { BiliClient } from '../client.ts';
import { biliResult, normalizeUrl, stripHtmlTags } from './helpers.ts';

const SEARCH_URL = 'https://api.bilibili.com/x/web-interface/wbi/search/type';

type BiliSearchType = 'video' | 'article' | 'live_room' | 'bili_user';

interface RawVideoSearchItem {
  bvid?: string;
  aid?: number;
  title?: string;
  author?: string;
  mid?: number;
  description?: string;
  pic?: string;
  duration?: string;
  pubdate?: number;
  play?: number;
  video_review?: number;
  review?: number;
  tag?: string;
}

interface RawArticleSearchItem {
  id?: number;
  title?: string;
  desc?: string;
  mid?: number;
  image_urls?: string[];
  pub_time?: number;
  view?: number;
  like?: number;
  reply?: number;
  category_name?: string;
}

interface RawLiveRoomSearchItem {
  roomid?: number;
  uid?: number;
  uname?: string;
  title?: string;
  user_cover?: string;
  cover?: string;
  online?: number;
  live_status?: number;
  cate_name?: string;
  attentions?: number;
}

interface RawUserSearchItem {
  mid?: number;
  uname?: string;
  usign?: string;
  fans?: number;
  videos?: number;
  level?: number;
  upic?: string;
  is_live?: number;
  room_id?: number;
  official_verify?: { type?: number; desc?: string };
}

interface RawSearchResponse<TItem> {
  result?: TItem[];
  numResults?: number;
  numPages?: number;
}

const searchTypeSchema = Type.Union(
  [
    Type.Literal('video'),
    Type.Literal('article'),
    Type.Literal('live_room'),
    Type.Literal('bili_user'),
  ],
  {
    description:
      '搜索类型：video 视频（默认）、article 专栏图文、live_room 直播间、bili_user 用户/主播',
  },
);

const searchOrderSchema = Type.String({
  description:
    '排序方式：视频与专栏 totalrank 综合排序（默认）/ click 最多点击 / pubdate 最新发布 / dm 最多弹幕 / stow 最多收藏；直播间 online 人气（默认）/ live_time 最新开播；用户 0 默认 / fans 粉丝数 / level 等级',
});

const searchSchema = Type.Object({
  keyword: Type.String({ minLength: 1, description: '搜索关键词' }),
  type: Type.Optional(searchTypeSchema),
  page: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 50, description: '页码，默认 1，每页 20 条' }),
  ),
  limit: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 20, description: '最多返回的条数，默认 10' }),
  ),
  order: Type.Optional(searchOrderSchema),
});

export const createSearchBiliTool = defineTool(searchSchema, (client: BiliClient) => ({
  name: 'search_bili',
  label: '搜索B站内容',
  description: prompt.inline`
      按关键词搜索 B 站视频、专栏图文、直播间或用户/主播，默认最多返回 10 条（limit 可调到上限 20）。
      返回结果已去掉标题中的关键词高亮标签；用户结果中的 roomId 可继续交给 get_bili_live_room 查询。
    `,
  execute: async (params, { signal }) => {
    const type = params.type ?? 'video';
    const page = params.page ?? 1;
    const limit = params.limit ?? 10;
    const keyword = params.keyword;

    if (type === 'article') {
      const data = await search<RawArticleSearchItem>(
        client,
        type,
        keyword,
        page,
        params.order,
        signal,
      );

      return biliResult({
        keyword,
        type,
        page,
        total: data.numResults,
        items: (data.result ?? []).slice(0, limit).map(normalizeArticleSearchItem),
      });
    }

    if (type === 'live_room') {
      const data = await search<RawLiveRoomSearchItem>(
        client,
        type,
        keyword,
        page,
        params.order,
        signal,
      );

      return biliResult({
        keyword,
        type,
        page,
        total: data.numResults,
        items: (data.result ?? []).slice(0, limit).map(normalizeLiveRoomSearchItem),
      });
    }

    if (type === 'bili_user') {
      const data = await search<RawUserSearchItem>(
        client,
        type,
        keyword,
        page,
        params.order,
        signal,
      );

      return biliResult({
        keyword,
        type,
        page,
        total: data.numResults,
        items: (data.result ?? []).slice(0, limit).map(normalizeUserSearchItem),
      });
    }

    const data = await search<RawVideoSearchItem>(
      client,
      'video',
      keyword,
      page,
      params.order,
      signal,
    );

    return biliResult({
      keyword,
      type,
      page,
      total: data.numResults,
      items: (data.result ?? []).slice(0, limit).map(normalizeVideoSearchItem),
    });
  },
}));

async function search<TItem>(
  client: BiliClient,
  searchType: BiliSearchType,
  keyword: string,
  page: number,
  order: string | undefined,
  signal: AbortSignal | undefined,
) {
  return client.request<RawSearchResponse<TItem>>(SEARCH_URL, {
    query: { search_type: searchType, keyword, page, order },
    signed: true,
    signal,
  });
}

function normalizeVideoSearchItem(item: RawVideoSearchItem) {
  return {
    bvid: item.bvid,
    aid: item.aid,
    title: stripHtmlTags(item.title ?? ''),
    author: stripHtmlTags(item.author ?? ''),
    uid: item.mid,
    description: stripHtmlTags(item.description ?? ''),
    cover: normalizeUrl(item.pic),
    duration: item.duration,
    publishedAt: item.pubdate,
    play: item.play,
    danmaku: item.video_review,
    comment: item.review,
    tags: item.tag ? item.tag.split(',') : [],
    url: item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : undefined,
  };
}

function normalizeArticleSearchItem(item: RawArticleSearchItem) {
  return {
    id: item.id,
    title: stripHtmlTags(item.title ?? ''),
    description: stripHtmlTags(item.desc ?? ''),
    uid: item.mid,
    cover: normalizeUrl(item.image_urls?.[0]),
    publishedAt: item.pub_time,
    view: item.view,
    like: item.like,
    reply: item.reply,
    category: item.category_name,
    url: item.id ? `https://www.bilibili.com/read/cv${item.id}` : undefined,
  };
}

function normalizeLiveRoomSearchItem(item: RawLiveRoomSearchItem) {
  return {
    roomId: item.roomid,
    uid: item.uid,
    name: stripHtmlTags(item.uname ?? ''),
    title: stripHtmlTags(item.title ?? ''),
    cover: normalizeUrl(item.user_cover) ?? normalizeUrl(item.cover),
    online: item.online,
    liveStatus: item.live_status,
    areaName: item.cate_name,
    attention: item.attentions,
    url: item.roomid ? `https://live.bilibili.com/${item.roomid}` : undefined,
  };
}

function normalizeUserSearchItem(item: RawUserSearchItem) {
  return {
    uid: item.mid,
    name: stripHtmlTags(item.uname ?? ''),
    sign: item.usign,
    fans: item.fans,
    videos: item.videos,
    level: item.level,
    avatar: normalizeUrl(item.upic),
    isLive: item.is_live === 1,
    roomId: item.room_id,
    verified: verifyText(item.official_verify),
    url: item.mid ? `https://space.bilibili.com/${item.mid}` : undefined,
  };
}

function verifyText(verify: { type?: number; desc?: string } | undefined) {
  // 127 表示未认证，0 为个人认证，1 为机构认证
  const isVerified = verify?.type === 0 || verify?.type === 1;

  return isVerified ? verify?.desc : undefined;
}
