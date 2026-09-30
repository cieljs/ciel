<script setup lang="ts">
import type { TraceClient } from '@cieljs/trace/client';
import { computed, watch } from 'vue';

import { useConsole } from '../../composables/use-console.ts';
import type { MessageRenderers } from '../../message-renderers.ts';
import type { ToolRenderers } from '../../tool-renderers.ts';
import {
  conversationEntries,
  indexToolCalls,
  type ToolCallRecord,
} from '../../utils/tool-calls.ts';
import AgentConversation from './AgentConversation.vue';

const props = withDefaults(
  defineProps<{
    client: TraceClient;
    sessionId: string;
    autoScroll?: boolean;
    emptyText?: string;
    toolRenderers?: ToolRenderers;
    messageRenderers?: MessageRenderers;
  }>(),
  { autoScroll: true },
);

const { entries, error, selectSession } = useConsole(props.client);

let indexed: Map<string, ToolCallRecord> | undefined;
const toolCalls = computed(() => (indexed = indexToolCalls(entries.value, indexed)));
const messages = computed(() => conversationEntries(entries.value, toolCalls.value).slice(-100));

watch(
  () => props.sessionId,
  sessionId => {
    if (sessionId) {
      void selectSession(sessionId);
    }
  },
  { immediate: true },
);
</script>

<template>
  <section class="ciel-console dt-conversation-panel" aria-label="Agent 对话">
    <p v-if="error" class="dt-error">{{ error }}</p>
    <AgentConversation
      :key="sessionId"
      :client="client"
      :messages="messages"
      :tool-calls="toolCalls"
      :auto-scroll="autoScroll"
      :empty-text="emptyText"
      :tool-renderers="toolRenderers"
      :message-renderers="messageRenderers"
    />
  </section>
</template>
