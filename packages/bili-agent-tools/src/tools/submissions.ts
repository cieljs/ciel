import { defineTool, prompt } from '@cieljs/agent-kit';
import { Type } from 'typebox';

import type { BiliClient } from '../client.ts';
import { biliResult } from './helpers.ts';

const VIDEO_LIST_URL = 'https://api.bilibili.com/x/space/wbi/arc/search';
const ARTICLE_LIST_URL = 'https://api.bilibili.com/x/space/wbi/article';

interface RawVideoItem {
  aid?: number;
  bvid?: string;
  title?: string;
  description?: string;
  pic?: string;
  length?: string;
  created?: number;
  play?: number;
  video_review?: number;
  comment?: number;
}

interface RawVideoListResponse {
  list?: { vlist?: RawVideoItem[] };
  page?: { count?: number };
}

interface RawArticleItem {
  id?: number;
  title?: string;
  summary?: string;
  banner_url?: string;
  publish_time?: number;
  words?: number;
  stats?: { view?: number; favorite?: number; like?: number; reply?: number };
}

interface RawArticleListResponse {
  articles?: RawArticleItem[];
  count?: number;
}

const submissionTypeSchema = Type.Union([Type.Literal('video'), Type.Literal('article')], {
  description: '投稿类型：video 视频投稿（默认），article 专栏图文投稿',
});

const submissionsSchema = Type.Object({
  uid: Type.Integer({
    minimum: 1,
    description: '目标用户 UID（B 站 mid），即空间地址 space.bilibili.com/{uid} 中的数字',
  }),
  type: Type.Optional(submissionTypeSchema),
  page: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: '页码，默认 1' })),
  limit: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 30, description: '每页数量，默认 10，最大 30' }),
  ),
  order: Type.Optional(
    Type.String({
      description:
        '排序方式：视频投稿 pubdate 最新发布（默认）/ click 最多播放 / stow 最多收藏；专栏投稿 publish_time 最新发布（默认）/ view 最多阅读 / fav 最多收藏',
    }),
  ),
  keyword: Type.Optional(Type.String({ description: '按关键词筛选视频投稿，仅 video 类型有效' })),
});

export const createGetUserSubmissionsTool = defineTool(submissionsSchema, (client: BiliClient) => ({
  name: 'get_bili_user_submissions',
  label: '查询B站用户投稿列表',
  description: prompt.inline`
      分页查询指定 UP 主/主播的投稿列表。type 为 video 时返回视频稿件（含播放、弹幕、评论数和时长），
      type 为 article 时返回专栏图文（含阅读、点赞、收藏数）。不支持音频投稿。
      返回的 page 与 limit 用于继续翻页，total 为投稿总数。
    `,
  execute: async (params, { signal }) => {
    const type = params.type ?? 'video';
    const page = params.page ?? 1;
    const limit = params.limit ?? 10;

    if (type === 'article') {
      const data = await client.request<RawArticleListResponse>(ARTICLE_LIST_URL, {
        query: { mid: params.uid, pn: page, ps: limit, sort: params.order },
        signed: true,
        signal,
      });

      return biliResult({
        uid: params.uid,
        type,
        page,
        limit,
        total: data.count,
        items: (data.articles ?? []).map(normalizeArticle),
      });
    }

    const data = await client.request<RawVideoListResponse>(VIDEO_LIST_URL, {
      query: {
        mid: params.uid,
        pn: page,
        ps: limit,
        order: params.order ?? 'pubdate',
        keyword: params.keyword,
        tid: 0,
        platform: 'web',
        web_location: '1550101',
      },
      signed: true,
      signal,
    });

    return biliResult({
      uid: params.uid,
      type,
      page,
      limit,
      total: data.page?.count,
      items: (data.list?.vlist ?? []).map(normalizeVideo),
    });
  },
}));

function normalizeVideo(item: RawVideoItem) {
  return {
    aid: item.aid,
    bvid: item.bvid,
    title: item.title,
    description: item.description,
    cover: item.pic,
    duration: item.length,
    publishedAt: item.created,
    play: item.play,
    danmaku: item.video_review,
    comment: item.comment,
    url: item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : undefined,
  };
}

function normalizeArticle(item: RawArticleItem) {
  return {
    id: item.id,
    title: item.title,
    summary: item.summary,
    cover: item.banner_url,
    publishedAt: item.publish_time,
    words: item.words,
    view: item.stats?.view,
    favorite: item.stats?.favorite,
    like: item.stats?.like,
    reply: item.stats?.reply,
    url: item.id ? `https://www.bilibili.com/read/cv${item.id}` : undefined,
  };
}
