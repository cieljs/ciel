import type { AgentTool } from '@earendil-works/pi-agent-core';

import { createBiliClient, type BiliClientOptions } from './client.ts';
import {
  createGetDynamicDetailTool,
  createGetPinnedDynamicTool,
  createGetUserDynamicsTool,
} from './tools/dynamics.ts';
import { createGetLiveRoomTool } from './tools/live.ts';
import { createSearchBiliTool } from './tools/search.ts';
import { createGetUserSubmissionsTool } from './tools/submissions.ts';

export { createBiliClient } from './client.ts';
export { BiliApiError } from './errors.ts';

export type { BiliApiRequest, BiliClient, BiliClientOptions } from './client.ts';

export type BiliAgentToolsOptions = BiliClientOptions;

/**
 * 创建一组哔哩哔哩 Web 接口查询工具：搜索、用户动态、动态详情、置顶动态、投稿列表和直播间信息。
 *
 * cookie 建议直接复用浏览器登录后的完整 Cookie（含 SESSDATA、bili_jct、buvid3），
 * 缺少登录态时部分接口会触发风控或只能看到公开数据。
 */
export function createBiliAgentTools(options: BiliAgentToolsOptions = {}): AgentTool[] {
  const client = createBiliClient(options);

  return [
    createSearchBiliTool(client),
    createGetUserDynamicsTool(client),
    createGetDynamicDetailTool(client),
    createGetPinnedDynamicTool(client),
    createGetUserSubmissionsTool(client),
    createGetLiveRoomTool(client),
  ];
}
