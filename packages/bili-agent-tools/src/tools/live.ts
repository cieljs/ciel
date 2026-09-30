import { defineTool, prompt } from '@cieljs/agent-kit';
import { Type } from 'typebox';

import type { BiliClient } from '../client.ts';
import { biliResult, normalizeUrl } from './helpers.ts';

const ROOM_INFO_URL = 'https://api.live.bilibili.com/room/v1/Room/get_info';
const ROOM_BY_USER_URL = 'https://api.live.bilibili.com/room/v1/Room/getRoomInfoOld';

interface RawRoomInfo {
  uid?: number;
  room_id?: number;
  short_id?: number;
  title?: string;
  description?: string;
  live_status?: number;
  live_time?: string;
  online?: number;
  attention?: number;
  area_name?: string;
  parent_area_name?: string;
  tags?: string;
  user_cover?: string;
  keyframe?: string;
}

interface RawRoomByUser {
  roomid?: number;
}

const liveRoomSchema = Type.Object({
  roomId: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: '直播间号，长号或短号均可，如 live.bilibili.com/5441 中的 5441',
    }),
  ),
  uid: Type.Optional(
    Type.Integer({ minimum: 1, description: '主播 UID，未提供 roomId 时用它反查直播间' }),
  ),
});

export const createGetLiveRoomTool = defineTool(liveRoomSchema, (client: BiliClient) => ({
  name: 'get_bili_live_room',
  label: '查询B站直播间信息',
  description: prompt.inline`
      查询直播间基本信息：标题、开播状态、分区、人气、关注数、封面与开始直播时间。
      已知直播间号时直接传 roomId，否则传主播 uid 反查；两者都没有会报错。
    `,
  execute: async (params, { signal }) => {
    const roomId = params.roomId ?? (await resolveRoomId(client, params.uid, signal));

    const info = await client.request<RawRoomInfo>(ROOM_INFO_URL, {
      query: { room_id: roomId },
      signal,
    });

    return biliResult({
      roomId: info.room_id,
      shortId: info.short_id,
      uid: info.uid,
      title: info.title,
      description: info.description,
      liveStatus: info.live_status,
      liveStatusText: liveStatusText(info.live_status),
      liveTime: info.live_time,
      online: info.online,
      attention: info.attention,
      areaName: info.area_name,
      parentAreaName: info.parent_area_name,
      tags: info.tags ? info.tags.split(',') : [],
      cover: normalizeUrl(info.user_cover),
      keyframe: normalizeUrl(info.keyframe),
      url: info.room_id ? `https://live.bilibili.com/${info.room_id}` : undefined,
    });
  },
}));

async function resolveRoomId(
  client: BiliClient,
  uid: number | undefined,
  signal: AbortSignal | undefined,
) {
  if (!uid) {
    throw new Error('查询直播间需要提供 roomId 或 uid');
  }

  const room = await client.request<RawRoomByUser>(ROOM_BY_USER_URL, {
    query: { mid: uid },
    signal,
  });

  if (!room.roomid) {
    throw new Error(`用户 ${uid} 没有开通直播间`);
  }

  return room.roomid;
}

function liveStatusText(status: number | undefined) {
  if (status === 1) {
    return '直播中';
  }

  if (status === 2) {
    return '轮播中';
  }

  return '未开播';
}
