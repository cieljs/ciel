import { expect, it, vi } from 'vite-plus/test';
import { effectScope } from 'vue';

import type { InvestigationClient, InvestigationConversation } from '../types.ts';
import { useInvestigationChat } from './use-investigation-chat.ts';

function conversation(sessionId: string): InvestigationConversation {
  return {
    sessionId,
    target: { type: 'global' },
    title: sessionId,
    label: '全局调查',
    createdAt: 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;

  const promise = new Promise<T>(complete => {
    resolve = complete;
  });

  return { promise, resolve };
}

it('回答期间允许切换、使用其他 Session 并新建调查', async () => {
  const first = conversation('first');
  const second = conversation('second');
  const created = conversation('created');
  const firstResponse = deferred<InvestigationConversation>();
  const secondResponse = deferred<InvestigationConversation>();

  const client = {
    list: vi.fn(async () => [first, second]),
    create: vi.fn(async () => created),
    rename: vi.fn(async () => created),
    delete: vi.fn(async () => {}),
    updates: vi.fn(async () => (async function* () {})()),
    prompt: vi.fn(({ sessionId }) => {
      return sessionId === first.sessionId ? firstResponse.promise : secondResponse.promise;
    }),
    abort: vi.fn(async () => {}),
  } satisfies InvestigationClient;

  const scope = effectScope();
  const chat = scope.run(() => useInvestigationChat(client))!;
  await chat.initialize();

  chat.select(first.sessionId);
  const firstRun = chat.prompt('第一条');
  expect(chat.sessionPending.value.get(first.sessionId)).toBe('prompt');

  chat.select(second.sessionId);
  expect(chat.conversation.value?.sessionId).toBe(second.sessionId);

  const secondRun = chat.prompt('第二条');
  expect(chat.sessionPending.value.get(second.sessionId)).toBe('prompt');

  await chat.create({ type: 'global' });
  expect(client.create).toHaveBeenCalledOnce();
  expect(chat.conversation.value?.sessionId).toBe(created.sessionId);
  expect(chat.sessionPending.value.size).toBe(2);

  firstResponse.resolve(first);
  await firstRun;
  expect(chat.sessionPending.value.has(first.sessionId)).toBe(false);
  expect(chat.sessionPending.value.get(second.sessionId)).toBe('prompt');

  secondResponse.resolve(second);
  await secondRun;
  expect(chat.sessionPending.value.size).toBe(0);

  scope.stop();
});
