import { MemoryManager, memoryStorage } from '@cieljs/memory';
import { SessionManager, sessionStorage } from '@cieljs/session';
import { Storage } from '@cieljs/storage';
import { fauxAssistantMessage, registerFauxProvider } from '@earendil-works/pi-ai/compat';
import { expect, test } from 'vite-plus/test';

import { createRuntimeSessionAgent } from '../src/agents/session-agent.ts';

test('会话超过预算后自动压缩，并把摘要同步给 Agent', async () => {
  await using storage = await Storage.open({
    dataDir: 'memory://',
    modules: [sessionStorage, memoryStorage],
  });
  await using sessions = await SessionManager.open({ storage, namespace: 'session' });
  await using memory = await MemoryManager.open({ storage, timeZone: 'Asia/Shanghai' });
  const faux = registerFauxProvider();

  try {
    const session = await sessions.space('room:1').openSession({ id: 'compaction' });
    const filler = '直播间里发生的一段历史对话内容。'.repeat(20);

    for (let index = 0; index < 6; index += 1) {
      await session.appendMessage({
        role: 'user',
        content: `第 ${index} 段：${filler}`,
        timestamp: Date.now(),
      });
    }

    faux.setResponses([
      fauxAssistantMessage('累计摘要：主播在讨论音乐。'),
      fauxAssistantMessage('好的'),
    ]);

    const handle = await createRuntimeSessionAgent({
      model: faux.getModel(),
      systemPrompt: '测试',
      tools: [],
      sessionManager: sessions,
      memoryManager: memory,
      spaceId: 'room:1',
      sessionId: 'compaction',
      compaction: { contextWindow: 300, reserveTokens: 50, keepRecentMessages: 2 },
      resolveSources: () => [],
      assertRunning: () => {},
      onClose: () => {},
    });

    await handle.agent.prompt('继续');

    expect((await session.getLatestCompaction())?.summary).toBe('累计摘要：主播在讨论音乐。');

    // 压缩后 Agent 只看见摘要加保留的原文，不能再拿着完整历史继续请求。
    const compacted = JSON.stringify(handle.agent.state.messages);
    expect(compacted).toContain('session_summary');
    expect(compacted).toContain('累计摘要：主播在讨论音乐。');
    expect(compacted).not.toContain('第 0 段');

    await handle.close();
  } finally {
    faux.unregister();
  }
}, 20_000);

test('手动压缩忽略阈值并同步 Agent 转录', async () => {
  await using storage = await Storage.open({
    dataDir: 'memory://',
    modules: [sessionStorage, memoryStorage],
  });
  await using sessions = await SessionManager.open({ storage, namespace: 'session' });
  await using memory = await MemoryManager.open({ storage, timeZone: 'Asia/Shanghai' });
  const faux = registerFauxProvider();

  try {
    const session = await sessions.space('room:2').openSession({ id: 'manual-compaction' });

    for (let index = 0; index < 3; index += 1) {
      await session.appendMessage({
        role: 'user',
        content: `第 ${index} 段历史`,
        timestamp: Date.now(),
      });
    }

    faux.setResponses([fauxAssistantMessage('手动摘要')]);

    const handle = await createRuntimeSessionAgent({
      model: faux.getModel(),
      systemPrompt: '测试',
      tools: [],
      sessionManager: sessions,
      memoryManager: memory,
      spaceId: 'room:2',
      sessionId: 'manual-compaction',
      // 窗口远大于历史，自动压缩不会触发，只有手动触发才会压缩。
      compaction: { contextWindow: 32000, keepRecentMessages: 1 },
      resolveSources: () => [],
      assertRunning: () => {},
      onClose: () => {},
    });

    expect(await handle.compactContext()).toBe(true);
    expect((await session.getLatestCompaction())?.summary).toBe('手动摘要');

    const compacted = JSON.stringify(handle.agent.state.messages);
    expect(compacted).toContain('session_summary');
    expect(compacted).not.toContain('第 0 段历史');

    // 没有新的可压缩历史时返回 false，不产生空摘要。
    expect(await handle.compactContext()).toBe(false);

    await handle.close();
  } finally {
    faux.unregister();
  }
}, 20_000);
