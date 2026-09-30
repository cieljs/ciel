import { Type } from 'typebox';

export const memoryQuerySchema = Type.String({
  minLength: 1,
  description: '记忆正文中的关键词或需要回忆的事实、事件、偏好；查询来源请使用 by_source 工具。',
});
export const memorySourceQuerySchema = Type.String({
  minLength: 1,
  description:
    '宿主记录的来源标识、名称、标题或别名，例如 session:abc 或主播昵称；不匹配记忆正文。',
});
export const memorySearchModeSchema = Type.Union(
  [
    Type.Literal('hybrid'),
    Type.Literal('full_text'),
    Type.Literal('trigram'),
    Type.Literal('vector'),
  ],
  {
    description:
      '默认 hybrid 融合检索；full_text 查关键词，trigram 查部分文本或近似拼写，vector 查语义。未配置向量模型时 vector 返回空结果。',
  },
);
export const memorySourceSearchModeSchema = Type.Union(
  [Type.Literal('auto'), Type.Literal('exact'), Type.Literal('text')],
  {
    description:
      '默认 auto 合并完整来源匹配和文本匹配；exact 要求完整来源标识，text 支持关键词与模糊匹配。',
  },
);
export const memoryIdSchema = Type.String({
  minLength: 1,
  description:
    '记忆 ID，取自正文搜索结果的 memory.id、来源搜索结果的 memoryId，或已提供的记忆上下文；不是空间或会话 ID。',
});
export const memoryOffsetSchema = Type.Integer({
  minimum: 0,
  description:
    '正文读取起点，默认 0。继续读取时原样传入上一页 nextOffset；nextOffset 为 null 表示读完。',
});
export const memorySearchLimitSchema = Type.Integer({
  minimum: 1,
  maximum: 20,
  description: '最多返回的命中条数，省略时使用宿主配置。',
});

export const memoryKindSchema = Type.Union([
  Type.Literal('event'),
  Type.Literal('fact'),
  Type.Literal('preference'),
  Type.Literal('summary'),
]);

export const memoryDateSchema = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
  description: '每日记忆归属的日期 YYYY-MM-DD；省略时按发生时间和宿主时区计算。',
});
export const memoryLayerSchema = Type.Union([
  Type.Literal('global.long_term'),
  Type.Literal('space.long_term'),
  Type.Literal('space.daily'),
]);
export const spaceMemoryLayerSchema = Type.Union([
  Type.Literal('space.long_term'),
  Type.Literal('space.daily'),
]);

export const readSchema = Type.Object({
  id: memoryIdSchema,
  offset: Type.Optional(memoryOffsetSchema),
});

export const searchSchema = Type.Object({
  query: memoryQuerySchema,
  mode: Type.Optional(memorySearchModeSchema),
  kind: Type.Optional(memoryKindSchema),
  limit: Type.Optional(memorySearchLimitSchema),
});

export const sourceSearchSchema = Type.Object({
  query: memorySourceQuerySchema,
  mode: Type.Optional(memorySourceSearchModeSchema),
  limit: Type.Optional(memorySearchLimitSchema),
});

const nullableTimestampSchema = Type.Union([Type.String(), Type.Null()], {
  description: '新的过期时刻，使用带时区的 ISO 时间；null 清除过期时间，省略则保留。',
});

export const updateSchema = Type.Object({
  id: memoryIdSchema,
  expectedRevision: Type.Integer({
    minimum: 1,
    description: '最近读取的记忆 revision，用于检测并发修改；不要猜测版本号。',
  }),
  content: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 16000,
      description: '替换后的完整正文，不是追加内容或 diff；省略则保留原文。',
    }),
  ),
  kind: Type.Optional(memoryKindSchema),
  expiresAt: Type.Optional(nullableTimestampSchema),
});

export const archiveSchema = Type.Object({
  id: memoryIdSchema,
  expectedRevision: Type.Integer({
    minimum: 1,
    description: '最近读取的记忆 revision，用于检测并发修改；不要猜测版本号。',
  }),
});
