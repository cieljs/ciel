import { MemoryManager, memoryStorage } from '@cieljs/memory';
import { SessionManager, sessionStorage } from '@cieljs/session';
import { Storage } from '@cieljs/storage';
import { TraceHost, traceStorage } from '@cieljs/trace/host';
import { VectorService, vectorStorage } from '@cieljs/vector';
import { expect, test, vi } from 'vite-plus/test';

test('同库业务隔离、跨业务缓存复用与调试投影重放', async () => {
  await using storage = await Storage.open({
    dataDir: 'memory://',
    modules: [sessionStorage, memoryStorage, vectorStorage, traceStorage],
  });
  const embedBatch = vi.fn(async (texts: string[]) => texts.map(() => [1, 0]));
  await using vectors = new VectorService({
    storage,
    provider: { model: 'test', dimensions: 2, embedBatch },
    providerId: 'test',
    revision: '1',
    granularity: 'chunk',
    inputConfig: 'raw',
  });
  await using sessions = await SessionManager.open({ storage, namespace: 'session', vectors });
  await using investigations = await SessionManager.open({ storage, namespace: 'investigation' });
  await using memory = await MemoryManager.open({ storage, timeZone: 'Asia/Shanghai', vectors });
  const session = await sessions.space('room').openSession();
  const investigation = await investigations.space('room').openSession();
  const message = { role: 'user' as const, content: 'shared text', timestamp: 1 };

  const record = await session.recordEvent({ type: 'message_end', message });
  await memory.space('room').longTerm.remember({ content: 'shared text' });
  await Promise.all([sessions.flushIndexes(), memory.flushIndexes()]);
  expect(embedBatch.mock.calls.flatMap(([texts]) => texts)).toEqual(['shared text']);
  expect(await sessions.getSessionAcrossSpaces(investigation.id)).toBeNull();
  expect(await investigations.getSessionAcrossSpaces(session.id)).toBeNull();
  expect(await session.search('shared text', { mode: 'vector' })).not.toHaveLength(0);

  const host = await TraceHost.open({ storage });
  const before = await host.store.list('entry');
  expect(await host.store.get(`${record.messageId}:output`)).toEqual(message);
  expect((await session.getMessages())[0]?.id).toBe(record.messageId);
  await host.close();

  await using reopened = await TraceHost.open({ storage });
  expect(await reopened.store.list('entry')).toEqual(before);
  await sessions.close();
  expect(await memory.space('room').search('shared text')).not.toHaveLength(0);
}, 30_000);
