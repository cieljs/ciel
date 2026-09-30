import { onScopeDispose, readonly, shallowRef } from 'vue';

import type {
  InvestigationClient,
  InvestigationConversation,
  InvestigationTargetInput,
} from '../types.ts';

export function useInvestigationChat(client: InvestigationClient) {
  const conversations = shallowRef<InvestigationConversation[]>([]);
  const conversation = shallowRef<InvestigationConversation>();
  const pending = shallowRef<'create' | 'delete'>();
  const sessionPending = shallowRef(new Map<string, 'prompt' | 'abort'>());
  const error = shallowRef('');
  const abortedSessions = new Set<string>();
  const updatesController = new AbortController();
  let updatesConnected = false;

  function saveConversation(updated: InvestigationConversation) {
    const index = conversations.value.findIndex(item => item.sessionId === updated.sessionId);

    conversations.value =
      index < 0
        ? [...conversations.value, updated]
        : conversations.value.map(item => (item.sessionId === updated.sessionId ? updated : item));

    if (conversation.value?.sessionId === updated.sessionId) {
      conversation.value = updated;
    }
  }

  function setSessionPending(sessionId: string, status?: 'prompt' | 'abort') {
    const next = new Map(sessionPending.value);

    if (status) {
      next.set(sessionId, status);
    } else {
      next.delete(sessionId);
    }

    sessionPending.value = next;
  }

  async function initialize() {
    if (pending.value) {
      return;
    }

    pending.value = 'create';
    error.value = '';
    connectUpdates();

    try {
      conversations.value = await client.list();
      conversation.value = conversations.value.at(-1);

      if (!conversation.value) {
        conversation.value = await client.create({ target: { type: 'global' } });
        conversations.value = [conversation.value];
      }
    } catch (cause) {
      error.value = String(cause);
    } finally {
      pending.value = undefined;
    }
  }

  function connectUpdates() {
    if (updatesConnected) {
      return;
    }

    updatesConnected = true;

    void (async () => {
      try {
        const updates = await client.updates(undefined, { signal: updatesController.signal });

        for await (const update of updates) {
          if (updatesController.signal.aborted) {
            return;
          }

          const current = conversations.value.find(item => item.sessionId === update.sessionId);

          if (current) {
            saveConversation({ ...current, title: update.title });
          }
        }
      } catch (cause) {
        if (!updatesController.signal.aborted) {
          error.value = String(cause);
        }
      }
    })();
  }

  async function create(target: InvestigationTargetInput) {
    if (pending.value) {
      return;
    }

    pending.value = 'create';
    error.value = '';

    try {
      conversation.value = await client.create({ target });
      saveConversation(conversation.value);
    } catch (cause) {
      error.value = String(cause);
    } finally {
      pending.value = undefined;
    }
  }

  function select(sessionId: string) {
    const selected = conversations.value.find(item => item.sessionId === sessionId);

    if (selected) {
      conversation.value = selected;
    }
  }

  async function rename(title: string) {
    const sessionId = conversation.value?.sessionId;
    const value = title.trim();

    if (!sessionId || !value) {
      return;
    }

    try {
      saveConversation(await client.rename({ sessionId, title: value }));
    } catch (cause) {
      error.value = String(cause);
    }
  }

  async function remove(sessionId: string) {
    if (pending.value || sessionPending.value.has(sessionId)) {
      return;
    }

    const deletedIndex = conversations.value.findIndex(item => item.sessionId === sessionId);

    if (deletedIndex < 0) {
      return;
    }

    pending.value = 'delete';
    error.value = '';

    try {
      await client.delete({ sessionId });

      const remaining = conversations.value.filter(item => item.sessionId !== sessionId);
      conversations.value = remaining;

      if (conversation.value?.sessionId === sessionId) {
        conversation.value = remaining.at(Math.min(deletedIndex, remaining.length - 1));
      }
    } catch (cause) {
      error.value = String(cause);
    } finally {
      pending.value = undefined;
    }
  }

  async function prompt(content: string) {
    const sessionId = conversation.value?.sessionId;

    if (!sessionId || pending.value || sessionPending.value.has(sessionId) || !content.trim()) {
      return;
    }

    const question = content.trim();

    if (conversation.value?.title === '新调查') {
      saveConversation({
        ...conversation.value,
        title: question.replace(/\s+/gu, ' ').slice(0, 36),
      });
    }

    setSessionPending(sessionId, 'prompt');
    error.value = '';

    try {
      saveConversation(await client.prompt({ sessionId, content: question }));
    } catch (cause) {
      if (!abortedSessions.has(sessionId)) {
        error.value = String(cause);
      }
    } finally {
      abortedSessions.delete(sessionId);
      setSessionPending(sessionId);
    }
  }

  async function abort() {
    const sessionId = conversation.value?.sessionId;

    if (!sessionId || sessionPending.value.get(sessionId) !== 'prompt') {
      return;
    }

    abortedSessions.add(sessionId);
    setSessionPending(sessionId, 'abort');

    try {
      await client.abort({ sessionId });
    } catch (cause) {
      abortedSessions.delete(sessionId);
      setSessionPending(sessionId, 'prompt');
      error.value = String(cause);
    }
  }

  onScopeDispose(() => updatesController.abort());

  return {
    conversations: readonly(conversations),
    conversation: readonly(conversation),
    pending: readonly(pending),
    sessionPending: readonly(sessionPending),
    error,
    initialize,
    create,
    select,
    rename,
    remove,
    prompt,
    abort,
  };
}
