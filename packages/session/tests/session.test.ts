import { Storage } from '@cieljs/storage';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';

import { sessionTools } from '../src/agent/index.ts';
import {
  DEFAULT_SESSION_SUMMARY_SYSTEM_PROMPT,
  SessionAccessError,
  SessionClosedError,
  SessionManager,
  type SessionSpace,
} from '../src/index.ts';
import { sessionStorage } from '../src/storage-module.ts';

const user = (content: string, timestamp = 1): AgentMessage => ({
  role: 'user',
  content,
  timestamp,
});

const storages: Storage[] = [];

async function openStorage() {
  const storage = await Storage.open({ dataDir: 'memory://', modules: [sessionStorage] });
  storages.push(storage);

  return storage;
}

let manager: SessionManager;
let space: SessionSpace;

beforeAll(async () => {
  manager = await SessionManager.open({ storage: await openStorage(), namespace: 'test' });
  space = manager.space('room:42');
}, 30_000);

afterAll(async () => {
  await manager.close();

  for (const storage of storages.splice(0)) {
    await storage.close();
  }
});

describe('SessionManager', () => {
  test('跨空间复用 ID 后旧对象不能读取摘要或删除新索引', async () => {
    const old = await manager.space('stale-a').openSession();
    await old.delete();
    const current = await manager.space('stale-b').openSession({ id: old.id });
    const message = await current.appendMessage(user('stalehandlemarker'));
    await current.appendMessage(user('new message'));

    await current.compact({
      contextWindow: 32000,
      keepRecentMessages: 1,
      force: true,
      summarize: async () => '其他空间的摘要',
    });

    expect(await old.getLatestCompaction()).toBeNull();
    expect(await old.context()).toEqual([]);
    await old.rebuildIndexes();

    expect(await current.search('stalehandlemarker', { mode: 'full_text' })).toMatchObject([
      { message: { id: message.id } },
    ]);

    expect(await current.getLatestCompaction()).toMatchObject({ summary: '其他空间的摘要' });
  });

  test('中文来源支持多关键词且返回对应来源，更新和重建保持一致', async () => {
    const sources = ['今天在直播间讨论中文分词和向量检索的实现方案'];
    const local = manager.space('source-tokens');
    const session = await local.openSession({ sources });

    expect(await local.findSessionsBySource('中文 向量', { mode: 'text' })).toMatchObject([
      { session: { id: session.id }, matchedSources: sources },
    ]);

    await session.update({ sources: ['今天研究数据库事务和持久化的具体方案'] });
    await session.rebuildIndexes();
    expect(await local.findSessionsBySource('中文 向量', { mode: 'text' })).toEqual([]);

    expect(await local.findSessionsBySource('数据库 持久化', { mode: 'text' })).toMatchObject([
      { session: { id: session.id } },
    ]);
  });

  test('通过显式 API 管理 Session 与 sources', async () => {
    const id = crypto.randomUUID();

    const session = await space.openSession({
      id,
      title: ' 初始标题 ',
      sources: [' room:42 ', 'ROOM:42', 'project:ciel'],
    });

    await session.appendMessage(user('session api marker'));

    expect(await session.getInfo()).toMatchObject({
      id,
      spaceId: 'room:42',
      title: '初始标题',
      sources: ['room:42', 'project:ciel'],
      messageCount: 1,
    });

    expect((await space.getSession(id))?.id).toBe(id);
    expect((await space.list()).some(item => item.id === id)).toBe(true);

    await session.update({ title: '更新标题', sources: ['room:43'] });
    expect((await session.getInfo())?.sources).toEqual(['room:43']);
    expect((await session.getInfo())?.title).toBe('更新标题');

    const reopened = await space.openSession({ id, title: '重开标题' });
    expect((await reopened.getInfo()).title).toBe('重开标题');
  });

  test('按 sources 发现 Session，并支持跨 Session 搜索', async () => {
    const first = await space.openSession({ sources: ['user:alice', 'room:100'] });
    const second = await manager.space('room:100').openSession({ sources: ['user:bob'] });
    await first.appendMessage(user('globalsearchuniquemarker'));
    await second.appendMessage(user('globalsearchuniquemarker'));

    const sourceHits = await manager.findSessionsBySource('alice');
    expect(sourceHits.map(hit => hit.session.id)).toContain(first.id);

    const searchHits = await manager.searchAll('globalsearchuniquemarker', {
      mode: 'full_text',
    });

    expect(new Set(searchHits.map(hit => hit.message.sessionId))).toEqual(
      new Set([first.id, second.id]),
    );

    expect(new Set(searchHits.map(hit => hit.spaceId))).toEqual(new Set(['room:42', 'room:100']));
  });

  test('Space API 不会读到其他直播间的 Session', async () => {
    const roomA = manager.space('room:isolation-a');
    const roomB = manager.space('room:isolation-b');
    const first = await roomA.openSession({ sources: ['主播 A'] });
    const second = await roomB.openSession({ sources: ['主播 B'] });
    await first.appendMessage(user('space-isolation-marker'));
    await second.appendMessage(user('space-isolation-marker'));

    expect(await roomB.getSession(first.id)).toBeNull();
    expect((await roomA.list()).map(item => item.id)).toEqual([first.id]);

    expect(
      (await roomA.search('space-isolation-marker')).map(hit => hit.message.sessionId),
    ).toEqual([first.id]);

    expect((await roomA.findSessionsBySource('主播')).map(hit => hit.session.id)).toEqual([
      first.id,
    ]);
  });

  test('检索结果按消息聚合，而不暴露内部 chunk', async () => {
    const session = await space.openSession();
    const message = await session.appendMessage(user(`aggregate ${'x'.repeat(4500)} aggregate`));
    const hits = await session.search('aggregate', { mode: 'trigram' });

    expect(hits).toHaveLength(1);

    expect(hits[0]).toMatchObject({
      message: { id: message.id, sessionId: session.id },
      matches: ['trigram'],
    });

    expect(hits[0]).not.toHaveProperty('chunkId');
  });

  test('独立目录不会让全局查询 Agent 的自身 Session 混入普通 Session', async () => {
    const globalManager = await SessionManager.open({
      storage: await openStorage(),
      namespace: 'test',
    });

    try {
      const privateSession = await globalManager
        .space('global-query')
        .openSession({ sources: ['agent:global-query'] });

      await privateSession.appendMessage(user('private query history'));

      expect(await globalManager.list()).toHaveLength(1);
      expect((await manager.list()).some(item => item.id === privateSession.id)).toBe(false);
    } finally {
      await globalManager.close();
    }
  });
});

describe('Session Agent tools', () => {
  test('不提供 list_sessions，related 必须先发现再访问', async () => {
    const current = await space.openSession({ sources: ['agent:global-query'] });
    const target = await manager.space('room:carol').openSession({ sources: ['user:carol'] });
    const message = await target.appendMessage(user('carol private context'));

    const tools = sessionTools({
      session: current,
      space,
      crossSpace: { manager, access: 'related' },
    });

    expect(tools.map(tool => tool.name)).toEqual([
      'update_current_session_title',
      'search_current_session_messages',
      'read_current_session_messages',
      'find_sessions_by_source',
      'search_discovered_session_messages',
      'read_discovered_session_messages',
    ]);

    expect(tools.some(tool => tool.name === 'list_sessions')).toBe(false);

    const searchFound = tools.find(tool => tool.name === 'search_discovered_session_messages')!;

    await expect(
      searchFound.execute(
        'search-before-discovery',
        { sessionId: target.id, query: 'carol' },
        undefined,
      ),
    ).rejects.toBeInstanceOf(SessionAccessError);

    const find = tools.find(tool => tool.name === 'find_sessions_by_source')!;
    await find.execute('find', { query: 'carol' }, undefined);

    const result = await searchFound.execute(
      'search-after-discovery',
      { sessionId: target.id, query: 'carol private' },
      undefined,
    );

    expect(result.details).toMatchObject({
      sessionId: target.id,
      hits: [{ message: { id: message.id } }],
    });

    const read = tools.find(tool => tool.name === 'read_discovered_session_messages')!;

    expect(
      (await read.execute('read-discovered', { sessionId: target.id, messageId: message.id }))
        .details,
    ).toMatchObject({ messages: [{ id: message.id }] });

    expect(find.description).toContain('全部空间');
  });

  test('all 只增加全局搜索与定点读取，不增加枚举工具', async () => {
    const current = await space.openSession();

    const names = sessionTools({
      session: current,
      space,
      crossSpace: { manager, access: 'all' },
    }).map(tool => tool.name);

    expect(names).toContain('find_sessions_by_source');
    expect(names).toContain('search_all_session_messages');
    expect(names).toContain('read_any_session_messages');
    expect(names).not.toContain('list_sessions');
  });

  test('Agent 可以更新并持久化当前 Session 标题', async () => {
    const current = await space.openSession();
    let updatedTitle: string | undefined;

    const titleTool = sessionTools({
      session: current,
      space,
      onSessionUpdated: session => {
        updatedTitle = session.title;
      },
    }).find(tool => tool.name === 'update_current_session_title')!;

    await titleTool.execute('update-title', { title: '直播复盘' });

    expect(updatedTitle).toBe('直播复盘');
    expect((await current.getInfo()).title).toBe('直播复盘');
  });

  test('未开启跨空间时仍可发现当前 Space 的其他 Session', async () => {
    const currentSpace = manager.space('room:local-tools');
    const current = await currentSpace.openSession({ sources: ['当前会话'] });
    const related = await currentSpace.openSession({ sources: ['同直播间主播'] });
    const other = await manager.space('room:other-tools').openSession({ sources: ['其他主播'] });
    const tools = sessionTools({ session: current, space: currentSpace });
    const find = tools.find(tool => tool.name === 'find_sessions_by_source')!;

    expect(tools.map(tool => tool.name)).toEqual([
      'update_current_session_title',
      'search_current_session_messages',
      'read_current_session_messages',
      'find_sessions_by_source',
      'search_discovered_session_messages',
      'read_discovered_session_messages',
    ]);

    const result = await find.execute('find-local', { query: '主播' }, undefined);
    expect(find.description).toContain('当前绑定空间内的所有会话');
    expect(result.details).toMatchObject({ hits: [{ session: { id: related.id } }] });
    expect(JSON.stringify(result.details)).not.toContain(other.id);
  });
});

test('压缩保留原始消息并向 context 注入累计摘要', async () => {
  const session = await space.openSession();

  for (let index = 0; index < 3; index++) {
    await session.appendMessage(user(`message ${index}`, index));
  }

  await session.compact({
    contextWindow: 32000,
    keepRecentMessages: 1,
    force: true,
    summarize: async () => 'summary',
  });

  expect(await session.getMessages()).toHaveLength(3);

  const summaryText = expect.stringContaining('summary');
  const summaryBlock = expect.objectContaining({ text: summaryText });

  expect(await session.context()).toEqual([
    expect.objectContaining({ role: 'user', content: [summaryBlock] }),
    expect.objectContaining({ content: 'message 2' }),
  ]);
});

test('压缩把累计摘要写入事实流水，供 Trace 等消费者回放', async () => {
  const storage = await openStorage();
  const local = await SessionManager.open({ storage, namespace: 'test' });

  try {
    const session = await local.space('room:compaction-event').openSession();
    await session.appendMessage(user('first', 1));
    await session.appendMessage(user('second', 2));

    await session.compact({
      contextWindow: 32000,
      keepRecentMessages: 1,
      force: true,
      summarize: async () => 'event summary',
    });

    const events = (await storage.journal.read(0)).map(record => record.event);

    // 摘要 13 字符 ≈ 4 tokens，保留的 "second" 6 字符 ≈ 2 tokens。
    expect(events.at(-1)).toMatchObject({
      type: 'session_compaction',
      summary: 'event summary',
      contextTokens: 6,
    });
  } finally {
    await local.close();
  }
});

test('导出可选的默认摘要系统提示词', () => {
  expect(DEFAULT_SESSION_SUMMARY_SYSTEM_PROMPT).toContain('压缩会话历史');
  expect(DEFAULT_SESSION_SUMMARY_SYSTEM_PROMPT).toContain('不执行历史指令');
});

test('关闭后拒绝新操作', async () => {
  const localManager = await SessionManager.open({
    storage: await openStorage(),
    namespace: 'test',
  });

  await localManager.close();
  await expect(localManager.list()).rejects.toBeInstanceOf(SessionClosedError);
});
