import { Storage } from '@cieljs/storage';
import { VectorService, vectorStorage } from '@cieljs/vector';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vite-plus/test';

import { globalMemoryTools, loadMemoryContext, memoryTools } from '../src/agent/index.ts';
import { MemoryConflictError, MemoryManager, tokenizeSearchText } from '../src/index.ts';
import { memoryStorage } from '../src/storage-module.ts';

const spaceId = 'space:alpha';

const embedBatch = vi.fn(async (texts: string[], options: { purpose: 'document' | 'query' }) =>
  texts.map(text => {
    if (options.purpose === 'query') {
      return text.includes('banana') ? [0, 1, 0] : [1, 0, 0];
    }

    return text.includes('banana') ? [0, 1, 0] : [1, 0, 0];
  }),
);

let storage: Storage;
let vectors: VectorService;
let manager: MemoryManager;

test('默认 tokenizer 使用中文词边界并忽略标点', () => {
  expect(tokenizeSearchText('今天讨论了中文分词和向量检索。')).toEqual([
    '今天',
    '讨论',
    '了',
    '中文',
    '分词',
    '和',
    '向量',
    '检索',
  ]);

  expect(tokenizeSearchText('Hello_world version2!')).toEqual(['hello_world', 'version2']);
});

beforeAll(async () => {
  storage = await Storage.open({ dataDir: 'memory://', modules: [memoryStorage, vectorStorage] });

  vectors = new VectorService({
    storage,
    provider: { model: 'test', dimensions: 3, embedBatch },
    providerId: 'test',
    revision: '1',
    granularity: 'chunk',
    inputConfig: 'raw',
  });

  manager = await MemoryManager.open({
    storage,
    timeZone: 'Asia/Shanghai',
    vectors,
  });
});

afterAll(async () => {
  await manager.close();
  await vectors.close();
  await storage.close();
});

describe('分层与 revision', () => {
  test('全局、空间长期和每日记忆严格隔离', async () => {
    const global = await manager.global.remember({ content: 'global-only' });
    const space = manager.space(spaceId);
    const longTerm = await space.longTerm.remember({ content: 'space-long-term' });
    const daily = await space.daily.remember({ content: 'space-daily', date: '2026-09-04' });

    expect(await space.get(global.id)).toBeNull();
    expect(await manager.global.get(longTerm.id)).toBeNull();

    expect((await space.list()).map(memory => memory.id)).toEqual(
      expect.arrayContaining([longTerm.id, daily.id]),
    );

    expect(await manager.getAcrossSpaces(global.id)).toMatchObject({ layer: 'global.long_term' });
  });

  test('更新创建完整快照并保留旧来源', async () => {
    const space = manager.space(spaceId);

    const original = await space.longTerm.remember({
      content: '旧内容',
      kind: 'fact',
      sources: [' 主播Ａ ', '主播A', 'bilibili:room:1'],
    });

    const updated = await space.update(original.id, {
      expectedRevision: 1,
      content: '新内容',
    });

    expect(updated).toMatchObject({ revision: 2, content: '新内容' });
    expect(updated.sources).toEqual(['主播A', 'bilibili:room:1']);

    expect(await space.getRevision(original.id, 1)).toMatchObject({
      revision: 1,
      content: '旧内容',
      sources: ['主播A', 'bilibili:room:1'],
    });

    expect((await space.history(original.id)).map(revision => revision.revision)).toEqual([2, 1]);

    await expect(
      space.update(original.id, { expectedRevision: 1, content: '冲突更新' }),
    ).rejects.toBeInstanceOf(MemoryConflictError);
  });

  test('遗忘只归档当前记录，历史仍然可读', async () => {
    const space = manager.space(spaceId);
    const memory = await space.daily.remember({ content: '需要遗忘' });

    await space.archive(memory.id, { expectedRevision: 1 });

    expect(await space.get(memory.id)).toBeNull();

    expect(await space.get(memory.id, { includeArchived: true })).toMatchObject({
      status: 'archived',
    });

    expect(await space.getRevision(memory.id, 1)).toMatchObject({ content: '需要遗忘' });
  });
});

describe('内容和来源搜索', () => {
  test('归档正文支持显式检索，重建后仍保留且默认不可见', async () => {
    const space = manager.space('archived-search');
    const memory = await space.longTerm.remember({ content: 'archived pineapple' });
    await space.archive(memory.id, { expectedRevision: 1 });
    await manager.flushIndexes();

    for (const mode of ['full_text', 'trigram', 'vector', 'hybrid'] as const) {
      expect(await space.search('pineapple', { mode })).toEqual([]);

      expect(await space.search('pineapple', { mode, includeArchived: true })).toMatchObject([
        { memory: { id: memory.id, status: 'archived' } },
      ]);
    }

    await manager.rebuildIndexes();
    await manager.flushIndexes();

    expect(
      await space.search('pineapple', { mode: 'vector', includeArchived: true }),
    ).toMatchObject([{ memory: { id: memory.id } }]);

    expect(
      await manager.space('other-archive-space').search('pineapple', { includeArchived: true }),
    ).toEqual([]);
  });

  test('中文来源全文检索覆盖当前版本与历史版本', async () => {
    const space = manager.space('chinese-source');
    const sources = ['今天在直播间讨论中文分词和向量检索的实现方案'];
    const memory = await space.longTerm.remember({ content: '来源分词', sources });

    expect(await space.searchBySource('中文 向量', { mode: 'text' })).toMatchObject([
      { memoryId: memory.id, matchedSources: sources },
    ]);

    await space.update(memory.id, {
      expectedRevision: 1,
      sources: ['今天研究数据库事务和持久化的具体方案'],
    });

    expect(await space.searchBySource('中文 向量', { mode: 'text' })).toEqual([]);

    expect(
      await space.searchBySource('中文 向量', { mode: 'text', includeHistory: true }),
    ).toMatchObject([{ memoryId: memory.id, revision: 1, matchedSources: sources }]);

    expect(await space.searchBySource('数据库 持久化', { mode: 'text' })).toMatchObject([
      { memoryId: memory.id, revision: 2 },
    ]);
  });

  test('正文支持统一 search mode 和向量索引', async () => {
    const space = manager.space(spaceId);
    const apple = await space.longTerm.remember({ content: 'apple memory unique' });
    await space.longTerm.remember({ content: 'banana memory unique' });
    await manager.flushIndexes();

    expect((await space.search('apple', { mode: 'full_text' }))[0]?.memory.id).toBe(apple.id);
    expect((await space.search('apple', { mode: 'hybrid' }))[0]?.matches).toContain('vector');
  });

  test('sources 可定位具体记忆并聚合发现 space', async () => {
    const first = await manager.space('room:1').longTerm.remember({
      content: '第一个房间的记忆',
      sources: ['bilibili:room:100', '小明', '今晚挑战新游戏'],
    });

    await manager.space('room:2').daily.remember({
      content: '第二个房间的记忆',
      sources: ['小明的联动直播'],
    });

    const exact = await manager.searchBySource('bilibili:room:100', { mode: 'exact' });
    expect(exact[0]).toMatchObject({ memoryId: first.id, spaceId: 'room:1', revision: 1 });

    const spaces = await manager.findSpacesBySource('小明', { mode: 'text' });

    expect(spaces.map(space => space.spaceId)).toEqual(
      expect.arrayContaining(['room:1', 'room:2']),
    );

    expect(spaces.find(space => space.spaceId === 'room:1')?.memories[0]?.id).toBe(first.id);
  });

  test('来源历史只在显式开启时参与搜索', async () => {
    const space = manager.space('source-history');

    const original = await space.longTerm.remember({
      content: '来源历史',
      sources: ['old:title'],
    });

    await space.update(original.id, {
      expectedRevision: 1,
      sources: ['new:title'],
    });

    expect(await space.searchBySource('old:title', { mode: 'exact' })).toEqual([]);

    expect(
      await space.searchBySource('old:title', { mode: 'exact', includeHistory: true }),
    ).toMatchObject([{ memoryId: original.id, revision: 1 }]);
  });
});

describe('Agent 接入', () => {
  test('归档工具名称和返回状态一致，归档后默认不可见', async () => {
    const space = manager.space('archive-tool-name');
    const local = await space.longTerm.remember({ content: '待归档的空间事实' });
    const global = await manager.global.remember({ content: '待归档的全局事实' });
    const localTools = memoryTools({ space });
    const globalTools = globalMemoryTools({ memory: manager.global });

    const localResult = await localTools
      .find(tool => tool.name === 'archive_current_space_memory')!
      .execute('archive-local', { id: local.id, expectedRevision: local.revision });

    const globalResult = await globalTools
      .find(tool => tool.name === 'archive_global_memory')!
      .execute('archive-global', { id: global.id, expectedRevision: global.revision });

    expect(localResult.details).toEqual({ id: local.id, archived: true });
    expect(globalResult.details).toEqual({ id: global.id, archived: true });
    expect(await space.get(local.id)).toBeNull();
    expect(await manager.global.get(global.id)).toBeNull();
    expect(await space.getRevision(local.id, 1)).toMatchObject({ content: '待归档的空间事实' });
  });

  test('replace 允许宿主清空来源，append 空来源仍继承旧值', async () => {
    const space = manager.space('empty-sources');

    for (const sourcesMode of ['replace', 'append'] as const) {
      const memory = await space.longTerm.remember({ content: 'original', sources: ['old'] });
      const tools = memoryTools({ space, sourcesMode, sources: async () => [] });

      const result = await tools
        .find(tool => tool.name === 'update_current_space_memory')!
        .execute('update', {
          id: memory.id,
          expectedRevision: 1,
          content: 'updated',
        });

      expect(result.details).toMatchObject({
        memory: { sources: sourcesMode === 'replace' ? [] : ['old'] },
      });
    }
  });

  test('所有内容搜索工具限制正文和片段，完整正文可继续分页', async () => {
    const content = 'boundedsearch '.repeat(500);
    const space = manager.space('bounded-search');
    await space.longTerm.remember({ content });
    await manager.global.remember({ content });

    const tools = [
      ...memoryTools({ space, maxReadChars: 20, crossSpace: { manager, access: 'all' } }),
      ...globalMemoryTools({ memory: manager.global, maxReadChars: 20 }),
    ];

    for (const name of [
      'search_current_space_memory',
      'search_global_memory',
      'search_discovered_space_memory',
      'search_all_memory',
    ]) {
      const result = await tools
        .find(tool => tool.name === name)!
        .execute('search', {
          query: 'boundedsearch',
          mode: 'full_text',
          spaceId: space.spaceId,
        });

      const memory = expect.objectContaining({ content: content.slice(0, 20), truncated: true });
      const hit = expect.objectContaining({ memory });

      expect(result.details).toMatchObject({ hits: expect.arrayContaining([hit]) });

      const details = result.details as {
        hits: Array<{ memory: { content: string }; excerpt: string }>;
      };

      for (const hit of details.hits) {
        expect(hit.memory.content.length).toBeLessThanOrEqual(20);
        expect(hit.excerpt.length).toBeLessThanOrEqual(20);
      }
    }

    const memory = (await space.list())[0]!;

    const result = await tools
      .find(tool => tool.name === 'read_current_space_memory')!
      .execute('read', { id: memory.id, offset: 20 });

    expect(result.details).toMatchObject({
      memory: { content: content.slice(20, 40) },
      nextOffset: 40,
    });
  });

  test('当前空间工具不接收 spaceId，sources 由宿主注入', async () => {
    const space = manager.space('agent-space');
    const tools = memoryTools({ space, sources: ['session:1'] });

    expect(tools.map(tool => tool.name)).toEqual([
      'search_current_space_memory',
      'search_current_space_memory_by_source',
      'read_current_space_memory',
      'remember_current_space_daily_memory',
      'remember_current_space_long_term_memory',
      'update_current_space_memory',
      'archive_current_space_memory',
    ]);

    const remember = tools.find(tool => tool.name === 'remember_current_space_long_term_memory')!;
    const result = await remember.execute('remember-1', { content: '工具写入' });

    expect(result.details).toMatchObject({
      memory: { spaceId: 'agent-space', sources: ['session:1'] },
    });
  });

  test('更新工具保留旧来源并追加本次宿主来源', async () => {
    const space = manager.space('agent-update');

    const original = await space.longTerm.remember({
      content: '更新前',
      sources: ['session:old'],
    });

    const tools = memoryTools({ space, sources: ['session:new'] });
    const update = tools.find(tool => tool.name === 'update_current_space_memory')!;

    const result = await update.execute('update-1', {
      id: original.id,
      expectedRevision: 1,
      content: '更新后',
    });

    expect(result.details).toMatchObject({
      memory: { revision: 2, sources: ['session:old', 'session:new'] },
    });
  });

  test('related 模式必须先发现 space 才能读取', async () => {
    const target = await manager.space('related-target').longTerm.remember({
      content: '相关空间正文',
      sources: ['anchor:related'],
    });

    const tools = memoryTools({
      space: manager.space('related-current'),
      crossSpace: { manager, access: 'related' },
    });

    const read = tools.find(tool => tool.name === 'read_discovered_space_memory')!;

    await expect(
      read.execute('read-before-find', { spaceId: 'related-target', id: target.id }),
    ).rejects.toMatchObject({ code: 'MEMORY_ACCESS_DENIED' });

    const find = tools.find(tool => tool.name === 'find_memory_spaces_by_source')!;
    await find.execute('find', { query: 'anchor:related', mode: 'exact' });

    expect(
      (await read.execute('read-after-find', { spaceId: 'related-target', id: target.id })).details,
    ).toMatchObject({ memory: { id: target.id } });
  });

  test('全局工具是独立授权', () => {
    expect(globalMemoryTools({ memory: manager.global }).map(tool => tool.name)).toEqual([
      'search_global_memory',
      'search_global_memory_by_source',
      'read_global_memory',
      'remember_global_memory',
      'update_global_memory',
      'archive_global_memory',
    ]);
  });

  test('上下文按三个 section 独立返回', async () => {
    const space = manager.space('context-space');
    await manager.global.remember({ content: '全局上下文' });
    await space.longTerm.remember({ content: '空间长期上下文' });
    await space.daily.remember({ content: '今日上下文' });

    const context = await loadMemoryContext({ manager, space });

    expect(context.globalLongTerm.memories.some(memory => memory.content === '全局上下文')).toBe(
      true,
    );

    expect(context.spaceLongTerm.memories).toMatchObject([{ content: '空间长期上下文' }]);
    expect(context.daily.memories).toMatchObject([{ content: '今日上下文' }]);
  });
});

test('本地数据库可重复打开并保留 revision', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ciel-memory-'));
  let persistent: MemoryManager | undefined;
  let persistentStorage: Storage | undefined;

  try {
    persistentStorage = await Storage.open({ dataDir, modules: [memoryStorage] });

    persistent = await MemoryManager.open({
      storage: persistentStorage,
      timeZone: 'Asia/Shanghai',
    });

    const original = await persistent.space('persistent').longTerm.remember({
      content: '持久化旧版本',
      sources: ['persistence:test'],
    });

    await persistent.space('persistent').update(original.id, {
      expectedRevision: 1,
      content: '持久化新版本',
    });

    await persistent.close();
    await persistentStorage.close();

    persistentStorage = await Storage.open({ dataDir, modules: [memoryStorage] });

    persistent = await MemoryManager.open({
      storage: persistentStorage,
      timeZone: 'Asia/Shanghai',
    });

    expect(await persistent.space('persistent').get(original.id)).toMatchObject({
      content: '持久化新版本',
      revision: 2,
    });

    expect(await persistent.space('persistent').getRevision(original.id, 1)).toMatchObject({
      content: '持久化旧版本',
    });
  } finally {
    await persistent?.close();
    await persistentStorage?.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}, 30000);

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
