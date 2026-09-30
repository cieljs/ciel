import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { memoryStorage } from '@cieljs/memory';
import { MemoryManager } from '@cieljs/memory';
import { sessionStorage } from '@cieljs/session';
import { SessionManager } from '@cieljs/session';
import { Storage } from '@cieljs/storage';
import { registerFauxProvider } from '@earendil-works/pi-ai/compat';
import { expect, test } from 'vite-plus/test';

import { createInvestigationTools } from '../src/agents/investigation-tools.ts';
import { createRuntimeSessionAgent } from '../src/agents/session-agent.ts';

test('跨 Space 读取需要授权，读取不会扩大房间写入权限', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ciel-cross-space-'));
  const storage = await Storage.open({ dataDir: root, modules: [sessionStorage, memoryStorage] });
  const sessions = await SessionManager.open({ storage, namespace: 'session' });
  const memory = await MemoryManager.open({ storage, timeZone: 'Asia/Shanghai' });
  const faux = registerFauxProvider();

  try {
    const other = await sessions
      .space('room:2')
      .openSession({ id: 'room:2:today', sources: ['streamer:2'] });

    const message = await other.appendMessage({
      role: 'user',
      content: '一起听音乐',
      timestamp: Date.now(),
    });

    const otherMemory = await memory
      .space('room:2')
      .longTerm.remember({ content: '主播喜欢音乐', sources: ['streamer:2'] });

    const base = {
      model: faux.getModel(),
      systemPrompt: '测试',
      tools: [],
      sessionManager: sessions,
      memoryManager: memory,
      spaceId: 'room:1',
      resolveSources: () => ['streamer:1'],
      assertRunning: () => {},
      onClose: () => {},
    };

    const local = await createRuntimeSessionAgent({ ...base, sessionId: 'local' });

    const shared = await createRuntimeSessionAgent({
      ...base,
      sessionId: 'shared',
      crossSpace: true,
    });

    const localFinder = local.agent.state.tools.find(
      tool => tool.name === 'find_sessions_by_source',
    )!;

    const sharedFinder = shared.agent.state.tools.find(
      tool => tool.name === 'find_sessions_by_source',
    )!;

    expect(
      JSON.stringify((await localFinder.execute('find-local', { query: 'streamer:2' })).details),
    ).not.toContain('room:2:today');

    expect(
      JSON.stringify((await sharedFinder.execute('find-shared', { query: 'streamer:2' })).details),
    ).toContain('room:2:today');

    const reader = shared.agent.state.tools.find(
      tool => tool.name === 'read_discovered_session_messages',
    )!;

    expect(
      JSON.stringify(
        (await reader.execute('read', { sessionId: other.id, messageId: message.id })).details,
      ),
    ).toContain('一起听音乐');

    const memoryFinder = shared.agent.state.tools.find(
      tool => tool.name === 'find_memory_spaces_by_source',
    )!;

    await memoryFinder.execute('find-memory', { query: 'streamer:2' });

    const memoryReader = shared.agent.state.tools.find(
      tool => tool.name === 'read_discovered_space_memory',
    )!;

    expect(
      JSON.stringify(
        (await memoryReader.execute('read-memory', { spaceId: 'room:2', id: otherMemory.id }))
          .details,
      ),
    ).toContain('主播喜欢音乐');

    const update = shared.agent.state.tools.find(
      tool => tool.name === 'update_current_space_memory',
    )!;

    await expect(
      update.execute('update-other', {
        id: otherMemory.id,
        expectedRevision: otherMemory.revision,
        content: '覆盖其他房间',
      }),
    ).rejects.toThrow();

    const investigationOptions = {
      sessionManager: sessions,
      memoryManager: memory,
      investigationSessionId: 'chat-1',
      target: { type: 'space' as const, spaceId: 'exploration' },
      resolveSources: () => ['streamer:2'],
    };

    const restricted = createInvestigationTools(investigationOptions);
    const allowed = createInvestigationTools({ ...investigationOptions, crossSpace: true });
    const restrictedRead = restricted.find(tool => tool.name === 'read_session')!;
    const allowedRead = allowed.find(tool => tool.name === 'read_session')!;
    const params = { sessionId: other.id, messageId: message.id };

    expect(
      JSON.stringify((await restrictedRead.execute('read-local', params)).details),
    ).not.toContain('一起听音乐');

    expect(JSON.stringify((await allowedRead.execute('read-cross', params)).details)).toContain(
      '一起听音乐',
    );

    expect(allowed.some(tool => /remember|update|archive/.test(tool.name))).toBe(false);

    const writable = createInvestigationTools({
      ...investigationOptions,
      memoryAccess: 'read-write',
      crossSpace: true,
    });

    expect(writable.some(tool => tool.name === 'remember_current_space_long_term_memory')).toBe(
      true,
    );

    expect(writable.some(tool => tool.name === 'remember_global_memory')).toBe(false);

    const rememberSpace = writable.find(
      tool => tool.name === 'remember_current_space_long_term_memory',
    )!;

    const rememberedSpace = await rememberSpace.execute('remember-space', {
      content: '调查补充的房间记忆',
    });

    expect(JSON.stringify(rememberedSpace.details)).toContain('investigation:chat-1');

    const global = createInvestigationTools({
      ...investigationOptions,
      target: { type: 'global' },
      memoryAccess: 'read-write',
    });

    expect(global.some(tool => tool.name === 'remember_global_memory')).toBe(true);

    expect(global.some(tool => tool.name === 'remember_current_space_long_term_memory')).toBe(
      false,
    );

    const rememberGlobal = global.find(tool => tool.name === 'remember_global_memory')!;

    const rememberedGlobal = await rememberGlobal.execute('remember-global', {
      content: '调查补充的全局记忆',
    });

    expect(JSON.stringify(rememberedGlobal.details)).toContain('investigation:chat-1');
    await local.close();
    await shared.close();
  } finally {
    await Promise.all([sessions.close(), memory.close()]);
    await storage.close();
    faux.unregister();
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
