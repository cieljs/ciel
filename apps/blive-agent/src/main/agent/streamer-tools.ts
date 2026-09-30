import { defineTool } from 'cieljs/agent-kit';
import { Type } from 'typebox';

import type { RoomInfo } from '../../shared/types.ts';
import type { BilibiliApi } from '../bilibili/api.ts';

const QuerySchema = Type.Object({
  uid: Type.Optional(
    Type.Integer({ minimum: 1, description: '主播 UID，省略时查询当前房间主播。' }),
  ),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, default: 8 })),
});

export function createStreamerTools(options: {
  api: BilibiliApi;
  room: () => RoomInfo | undefined;
  readInPage: (url: string) => Promise<unknown>;
}) {
  return [
    {
      name: 'get_streamer_dynamics',
      label: '查询主播动态',
      query: options.api.streamerDynamics.bind(options.api),
    },
    {
      name: 'get_streamer_videos',
      label: '查询主播投稿',
      query: options.api.streamerVideos.bind(options.api),
    },
  ].map(({ name, label, query }) =>
    defineTool(QuerySchema, () => ({
      name,
      label,
      description: `${label}的近期公开列表，limit 默认 8、最多 20。仅在理解当前话题需要时调用。结果属于公开资料，不代表亲历或已观看视频；查询失败会报错，不代表没有内容。`,
      async execute({ uid, limit = 8 }, { signal }) {
        signal?.throwIfAborted();
        const streamerUid = uid ?? options.room()?.streamerUid;

        if (!streamerUid) {
          throw new Error('没有当前主播，请显式提供 uid');
        }

        const items = await query(streamerUid, options.readInPage, limit);
        signal?.throwIfAborted();
        const details = { uid: streamerUid, source: 'public' as const, items };

        return { content: [{ type: 'text' as const, text: JSON.stringify(details) }], details };
      },
    }))(),
  );
}
