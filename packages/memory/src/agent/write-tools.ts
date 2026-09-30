import { defineTool } from '@cieljs/agent-kit';
import { Type } from 'typebox';

import { MemoryNotFoundError } from '../errors.ts';
import type { UpdateMemoryInput } from '../types.ts';
import { normalizeSources } from '../validation.ts';
import { memoryResult, parseDate, previewMemory } from './helpers.ts';
import { memoryKindSchema, memoryDateSchema, updateSchema, archiveSchema } from './schemas.ts';
import {
  sourceContext,
  type SpaceToolOptions,
  type LongTermRememberToolOptions,
  type UpdateToolOptions,
  type ArchiveToolOptions,
} from './tool-context.ts';

const optionalTimestampSchema = Type.Optional(Type.String());

export const rememberCurrentSpaceDailyMemoryTool = defineTool(
  Type.Object({
    content: Type.String({ minLength: 1, maxLength: 16000 }),
    kind: Type.Optional(memoryKindSchema),
    date: Type.Optional(memoryDateSchema),
    occurredAt: optionalTimestampSchema,
    expiresAt: optionalTimestampSchema,
  }),
  ({ space, resolved }: SpaceToolOptions) => ({
    name: 'remember_current_space_daily_memory',
    label: '保存当前空间每日记忆',
    description:
      '在当前空间新增一条按日期归属的事件或短期状态记忆。date 省略时按 occurredAt 和宿主时区计算，occurredAt 省略时使用当前时间。每日记忆不会自动过期，需要时显式设置 expiresAt。来源由宿主注入；先检索避免重复，不把推测当作事实。',
    execute: async (params, context) => {
      const sources = await resolved.resolveSources(sourceContext(context, 'remember'));

      const memory = await space.daily.remember({
        content: params.content,
        kind: params.kind,
        date: params.date,
        occurredAt: parseDate(params.occurredAt),
        expiresAt: parseDate(params.expiresAt),
        sources,
      });

      return memoryResult({ memory: previewMemory(memory, resolved.maxReadChars) });
    },
  }),
);

export const rememberLongTermMemoryTool = defineTool(
  Type.Object({
    content: Type.String({ minLength: 1, maxLength: 16000 }),
    kind: Type.Optional(memoryKindSchema),
    occurredAt: optionalTimestampSchema,
    expiresAt: optionalTimestampSchema,
  }),
  ({ name, label, memory, resolved }: LongTermRememberToolOptions) => ({
    name,
    label,
    description: `${label}：新增一条稳定事实、偏好或长期有效的总结，范围固定为工具名称指定的层级。来源由宿主注入；先检索避免重复，修改已有事实应使用相同范围的 update 工具。不要保存未经确认的推测。`,
    execute: async (params, context) => {
      const sources = await resolved.resolveSources(sourceContext(context, 'remember'));

      const entry = await memory.remember({
        content: params.content,
        kind: params.kind,
        occurredAt: parseDate(params.occurredAt),
        expiresAt: parseDate(params.expiresAt),
        sources,
      });

      return memoryResult({ memory: previewMemory(entry, resolved.maxReadChars) });
    },
  }),
);

export const updateMemoryTool = defineTool(
  updateSchema,
  ({ name, label, memory, resolved }: UpdateToolOptions) => ({
    name,
    label,
    description: `${label}：先用相同范围的读取工具逐页读完正文，取得最新 revision，再将其作为 expectedRevision 提交。content 是整体替换，未提供的字段保留；不要拿搜索片段覆盖正文。expiresAt 传 null 可清除过期时间，sources 由宿主注入。版本冲突时重新读取再判断，不盲目重试。`,
    execute: async (params, context) => {
      context.signal?.throwIfAborted();
      const current = await memory.get(params.id, { includeExpired: true });

      if (!current) {
        throw new MemoryNotFoundError();
      }

      const injectedSources = await resolved.resolveSources(sourceContext(context, 'update'));

      const update: UpdateMemoryInput = {
        expectedRevision: params.expectedRevision,
        content: params.content,
        kind: params.kind,
        expiresAt: parseDate(params.expiresAt),
      };

      if (resolved.sourcesMode === 'replace' || injectedSources.length) {
        update.sources =
          resolved.sourcesMode === 'replace'
            ? injectedSources
            : normalizeSources([...current.sources, ...injectedSources]);
      }

      const entry = await memory.update(params.id, update);

      return memoryResult({ memory: previewMemory(entry, resolved.maxReadChars) });
    },
  }),
);

export const archiveMemoryTool = defineTool(
  archiveSchema,
  ({ name, label, memory }: ArchiveToolOptions) => ({
    name,
    label,
    description: `${label}：使用记忆 ID 和最新 revision（作为 expectedRevision），归档错误、过时或不应继续使用的记录。归档后不再出现在默认搜索和读取中，但历史仍保留；这不是物理删除。仅可操作工具名称指定范围的记忆。`,
    execute: async (params, { signal }) => {
      signal?.throwIfAborted();
      await memory.archive(params.id, { expectedRevision: params.expectedRevision });

      return memoryResult({ id: params.id, archived: true });
    },
  }),
);
