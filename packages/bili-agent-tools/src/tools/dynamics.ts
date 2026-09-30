import { defineTool, prompt } from '@cieljs/agent-kit';
import { Type } from 'typebox';

import type { BiliClient } from '../client.ts';
import { biliResult, compactStrings, normalizeUrl } from './helpers.ts';

const SPACE_FEED_URL = 'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space';

const DYNAMIC_DETAIL_URL = 'https://api.bilibili.com/x/polymer/web-dynamic/v1/detail';

const SPACE_FEED_FEATURES =
  'itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,forwardListHidden,decorationCard,commentsNewVersion,onlyfansAssetsV2,ugcDelete,onlyfansQaCard';

interface RawArchive {
  bvid?: string;
  title?: string;
  cover?: string;
  desc?: string;
  duration_text?: string;
  jump_url?: string;
  stat?: { play?: number | string; danmaku?: number | string };
}

interface RawLivePlayInfo {
  room_id?: number;
  uid?: number;
  title?: string;
  cover?: string;
  live_status?: number;
  online?: number;
  area_name?: string;
  parent_area_name?: string;
  live_start_time?: number;
  link?: string;
}

interface RawDynamicItem {
  id_str?: string;
  type?: string;
  basic?: { jump_url?: string };
  modules?: {
    module_author?: {
      mid?: number;
      name?: string;
      // pub_ts 在不同接口里可能是数字或数字字符串
      pub_ts?: number | string;
      pub_time?: string;
      pub_action?: string;
    };
    module_dynamic?: {
      desc?: { text?: string } | null;
      major?: {
        opus?: {
          title?: string | null;
          summary?: { text?: string } | null;
          pics?: Array<{ url?: string }>;
        } | null;
        archive?: RawArchive | null;
        draw?: { items?: Array<{ src?: string }> } | null;
        common?: { title?: string; desc?: string; cover?: string; jump_url?: string } | null;
        // 开播提醒动态，content 是内嵌的 JSON 字符串
        live_rcmd?: { content?: string } | null;
      } | null;
    };
    module_stat?: {
      comment?: { count?: number };
      forward?: { count?: number };
      like?: { count?: number };
    };
    module_tag?: { text?: string } | null;
  };
  orig?: RawDynamicItem;
}

interface RawSpaceFeed {
  items?: RawDynamicItem[];
  offset?: string;
  has_more?: boolean;
}

type RawDynamicModule = NonNullable<NonNullable<RawDynamicItem['modules']>['module_dynamic']>;

interface DynamicVideo {
  bvid: string;
  title: string | undefined;
  description: string | undefined;
  cover: string | undefined;
  duration: string | undefined;
  play: number | undefined;
  danmaku: number | undefined;
  url: string;
}

interface DynamicLink {
  title: string | undefined;
  description: string | undefined;
  cover: string | undefined;
  url: string | undefined;
}

interface DynamicLive {
  roomId: number | undefined;
  uid: number | undefined;
  title: string | undefined;
  cover: string | undefined;
  liveStatus: number | undefined;
  online: number | undefined;
  areaName: string | undefined;
  parentAreaName: string | undefined;
  startedAt: number | undefined;
  url: string | undefined;
}

interface NormalizedDynamic {
  id: string | undefined;
  type: string | undefined;
  isPinned: boolean;
  url: string;
  author: { uid: number | undefined; name: string | undefined };
  publishedAt: number | undefined;
  publishedAtText: string | undefined;
  action: string | undefined;
  text: string;
  images: string[];
  video: DynamicVideo | undefined;
  link: DynamicLink | undefined;
  live: DynamicLive | undefined;
  stats: { like: number | undefined; comment: number | undefined; forward: number | undefined };
  forward: NormalizedDynamic | undefined;
}

const uidSchema = Type.Integer({
  minimum: 1,
  description: '目标用户 UID（B 站 mid），即空间地址 space.bilibili.com/{uid} 中的数字',
});

const userDynamicsSchema = Type.Object({
  uid: uidSchema,
  offset: Type.Optional(
    Type.String({ description: '翻页游标，使用上一次返回的 nextOffset，首次查询不要填写' }),
  ),
  limit: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 20, description: '最多返回的动态条数，默认 10' }),
  ),
});

const pinnedDynamicSchema = Type.Object({ uid: uidSchema });

const dynamicDetailSchema = Type.Object({
  id: Type.String({
    minLength: 1,
    description:
      '动态 id 或 opus 动态页面地址，如 1252647612996124681；动态 id 是 19 位数字，必须按字符串传入',
  }),
});

export const createGetUserDynamicsTool = defineTool(userDynamicsSchema, (client: BiliClient) => ({
  name: 'get_bili_user_dynamics',
  label: '查询B站用户动态',
  description: prompt.inline`
      查询指定 UP 主/主播的最近动态，默认最多返回 10 条（limit 可调到上限 20），包含文字、图文、视频投稿、转发、开播提醒等类型。
      需要继续翻页时把返回的 nextOffset 作为 offset 再次调用；单条完整正文用 get_bili_dynamic_detail，置顶动态用 get_bili_pinned_dynamic。
      该接口未登录时容易被风控拦截（HTTP 412），建议创建工具时传入登录 Cookie。
    `,
  execute: async (params, { signal }) => {
    const limit = params.limit ?? 10;
    const feed = await fetchSpaceFeed(client, params.uid, params.offset, signal);

    return biliResult({
      uid: params.uid,
      items: (feed.items ?? []).slice(0, limit).map(normalizeDynamic),
      nextOffset: feed.has_more ? (feed.offset ?? null) : null,
    });
  },
}));

export const createGetPinnedDynamicTool = defineTool(pinnedDynamicSchema, (client: BiliClient) => ({
  name: 'get_bili_pinned_dynamic',
  label: '查询B站用户置顶动态',
  description: prompt.inline`
      查询指定 UP 主/主播当前置顶的动态。没有置顶动态时返回 dynamic 为 null。
      需要浏览多条动态时用 get_bili_user_dynamics；该接口同样建议传入登录 Cookie。
    `,
  execute: async (params, { signal }) => {
    const feed = await fetchSpaceFeed(client, params.uid, undefined, signal);
    const pinned = (feed.items ?? []).find(isPinnedDynamic);

    return biliResult({
      uid: params.uid,
      dynamic: pinned ? normalizeDynamic(pinned) : null,
    });
  },
}));

export const createGetDynamicDetailTool = defineTool(dynamicDetailSchema, (client: BiliClient) => ({
  name: 'get_bili_dynamic_detail',
  label: '查询B站动态详情',
  description: prompt.inline`
      查询单条动态的完整内容：不截断的正文、全部图片、视频稿件、直播卡片与互动数据。
      id 传动态 id 或 opus 页面地址，通常来自 get_bili_user_dynamics 返回的 items[].id。
    `,
  execute: async (params, { signal }) => {
    const detail = await client.request<{ item?: RawDynamicItem }>(DYNAMIC_DETAIL_URL, {
      query: { id: parseDynamicId(params.id), features: SPACE_FEED_FEATURES },
      signal,
    });

    return biliResult(detail.item ? normalizeDynamic(detail.item) : null);
  },
}));

async function fetchSpaceFeed(
  client: BiliClient,
  uid: number,
  offset: string | undefined,
  signal: AbortSignal | undefined,
) {
  return client.request<RawSpaceFeed>(SPACE_FEED_URL, {
    query: {
      host_mid: uid,
      offset,
      features: SPACE_FEED_FEATURES,
      platform: 'web',
      timezone_offset: -480,
      web_location: '333.1387',
    },
    signed: true,
    signal,
  });
}

function isPinnedDynamic(item: RawDynamicItem) {
  return item.modules?.module_tag?.text === '置顶';
}

function parseDynamicId(value: string) {
  // 允许直接粘贴 opus 页面地址，去掉 query/hash 与结尾斜杠后取末尾数字
  const path = value.trim().split(/[?#]/)[0].replace(/\/+$/, '');
  const matched = /(\d+)$/.exec(path);

  if (!matched) {
    throw new Error(`无法从「${value}」解析出动态 id，请传入动态 id 或 opus 页面地址`);
  }

  return matched[1];
}

function normalizeDynamic(item: RawDynamicItem): NormalizedDynamic {
  const dynamic = item.modules?.module_dynamic;
  const author = item.modules?.module_author;

  return {
    id: item.id_str,
    type: item.type,
    isPinned: isPinnedDynamic(item),
    url: dynamicUrl(item),
    author: { uid: author?.mid, name: author?.name },
    publishedAt: toNumber(author?.pub_ts),
    publishedAtText: author?.pub_time,
    action: author?.pub_action,
    text: dynamicText(dynamic),
    images: dynamicImages(dynamic),
    video: dynamicVideo(dynamic),
    link: dynamicLink(dynamic),
    live: dynamicLive(dynamic),
    stats: dynamicStats(item),
    forward: item.orig ? normalizeDynamic(item.orig) : undefined,
  };
}

function dynamicUrl(item: RawDynamicItem) {
  const jumpUrl = normalizeUrl(item.basic?.jump_url);

  if (jumpUrl) {
    return jumpUrl;
  }

  // 投稿类动态的 basic.jump_url 可能为空，回落到稿件地址
  const archiveUrl = normalizeUrl(item.modules?.module_dynamic?.major?.archive?.jump_url);

  return archiveUrl ?? `https://www.bilibili.com/opus/${item.id_str}`;
}

function dynamicStats(item: RawDynamicItem) {
  const stat = item.modules?.module_stat;

  return {
    like: stat?.like?.count,
    comment: stat?.comment?.count,
    forward: stat?.forward?.count,
  };
}

function dynamicText(dynamic: RawDynamicModule | undefined) {
  const opus = dynamic?.major?.opus;

  // 图文动态的摘要通常与标题重复，按原顺序去重后拼接
  const texts = compactStrings([dynamic?.desc?.text, opus?.title, opus?.summary?.text]);

  return Array.from(new Set(texts)).join('\n').trim();
}

function dynamicImages(dynamic: RawDynamicModule | undefined) {
  const pics = dynamic?.major?.opus?.pics;

  if (pics?.length) {
    return compactStrings(pics.map(pic => normalizeUrl(pic.url)));
  }

  const drawItems = dynamic?.major?.draw?.items;

  if (drawItems?.length) {
    return compactStrings(drawItems.map(drawItem => normalizeUrl(drawItem.src)));
  }

  return [];
}

function dynamicVideo(dynamic: RawDynamicModule | undefined) {
  const archive = dynamic?.major?.archive;

  if (!archive?.bvid) {
    return undefined;
  }

  return {
    bvid: archive.bvid,
    title: archive.title,
    description: archive.desc,
    cover: normalizeUrl(archive.cover),
    duration: archive.duration_text,
    play: parseCount(archive.stat?.play),
    danmaku: parseCount(archive.stat?.danmaku),
    url: `https://www.bilibili.com/video/${archive.bvid}`,
  };
}

function dynamicLink(dynamic: RawDynamicModule | undefined) {
  const common = dynamic?.major?.common;

  if (!common) {
    return undefined;
  }

  return {
    title: common.title,
    description: common.desc,
    cover: normalizeUrl(common.cover),
    url: normalizeUrl(common.jump_url),
  };
}

function dynamicLive(dynamic: RawDynamicModule | undefined) {
  const content = dynamic?.major?.live_rcmd?.content;

  if (!content) {
    return undefined;
  }

  const playInfo = parseLiveRcmdContent(content)?.live_play_info;

  if (!playInfo) {
    return undefined;
  }

  return {
    roomId: playInfo.room_id,
    uid: playInfo.uid,
    title: playInfo.title,
    cover: normalizeUrl(playInfo.cover),
    liveStatus: playInfo.live_status,
    online: playInfo.online,
    areaName: playInfo.area_name,
    parentAreaName: playInfo.parent_area_name,
    startedAt: playInfo.live_start_time,
    url: playInfo.room_id
      ? `https://live.bilibili.com/${playInfo.room_id}`
      : normalizeUrl(playInfo.link),
  };
}

function parseLiveRcmdContent(content: string) {
  try {
    return JSON.parse(content) as { live_play_info?: RawLivePlayInfo };
  } catch {
    // content 是内嵌 JSON 字符串，解析失败只影响这一张直播卡片
    return undefined;
  }
}

function toNumber(value: number | string | undefined) {
  if (typeof value === 'number') {
    return value;
  }

  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseCount(value: number | string | undefined) {
  const plain = toNumber(value);

  if (plain !== undefined || typeof value !== 'string') {
    return plain;
  }

  // 动态卡片里的播放/弹幕数会是 "11.3万" 这类带单位的字符串
  const matched = /^([\d.]+)(万|亿)?$/.exec(value);

  if (!matched) {
    return undefined;
  }

  const amount = Number(matched[1]);

  if (!Number.isFinite(amount)) {
    return undefined;
  }

  if (matched[2] === '万') {
    return Math.round(amount * 10_000);
  }

  if (matched[2] === '亿') {
    return Math.round(amount * 100_000_000);
  }

  return amount;
}
