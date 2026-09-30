<script setup lang="ts">
import type { TraceClient } from '@cieljs/trace/client';
import { Button, Tabs } from '@vuetify/v0/components';
import { computed, shallowRef, watch } from 'vue';

import { useConsole } from '../composables/use-console.ts';
import type { MessageRenderers } from '../message-renderers.ts';
import type { ToolRenderers } from '../tool-renderers.ts';
import { indexToolCalls, conversationEntries, type ToolCallRecord } from '../utils/tool-calls.ts';
import ContentRenderer from './content/ContentRenderer.vue';
import JsonView from './content/JsonView.vue';
import AgentConversation from './conversation/AgentConversation.vue';
import ExecutionView from './execution/ExecutionView.vue';
import SessionStatusBar from './session/SessionStatusBar.vue';
import SessionToolbar from './session/SessionToolbar.vue';

const props = withDefaults(
  defineProps<{
    client: TraceClient;
    autoScroll?: boolean;
    /** 宿主当前活动的 Session。变化时自动切换；用户手动选择其它 Session 不受影响。 */
    sessionId?: string;
    /** 按工具机器名索引的自定义渲染器；请用普通常量或 markRaw，不要放进 reactive。 */
    toolRenderers?: ToolRenderers;
    /** 宿主自定义消息渲染器，命中谓词的消息替换默认 Markdown/图片渲染；同样别放进 reactive。 */
    messageRenderers?: MessageRenderers;
  }>(),
  { autoScroll: true },
);

const {
  steps,
  entries,
  sessions,
  selectedSession,
  selectedSessionId,
  error,
  hasOlder,
  loadingOlder,
  older,
  selectSession,
  connect,
  clear,
} = useConsole(props.client);

const query = shallowRef('');
// 复用上一次的索引：流式期间 entries 频繁变化，Map 实例不变才能让未受影响的消息卡片跳过重渲染。
let indexed: Map<string, ToolCallRecord> | undefined;
const toolCalls = computed(() => (indexed = indexToolCalls(entries.value, indexed)));

const messages = computed(() => conversationEntries(entries.value, toolCalls.value).slice(-50));

const tab = shallowRef('conversation');

const sessionModel = computed({
  get: () => selectedSessionId.value,
  set: value => void selectSession(value),
});

// 宿主切换房间后跟随其 Session；手动选择仍可停留在其它 Session，直到下一次变化。
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
  <section class="ciel-console" aria-label="Ciel Console">
    <Tabs.Root v-model="tab">
      <SessionToolbar v-model:session-id="sessionModel" :sessions="sessions">
        <!-- 宿主操作排在 Session 右侧、「清空视图」左侧：控制台不认识这些按钮的语义，只给位置。 -->
        <slot name="actions" />
        <Button.Root
          class="dt-button dt-clear"
          aria-label="清空视图"
          title="清空视图"
          @click="clear"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
          </svg>
        </Button.Root>
      </SessionToolbar>
      <p v-if="error" class="dt-error">
        {{ error }}<Button.Root class="dt-button" @click="connect">重新连接</Button.Root>
      </p>
      <Tabs.Panel value="execution" class="dt-execution-panel">
        <ExecutionView
          :key="selectedSessionId"
          v-model:query="query"
          :client="client"
          :steps="steps"
          :has-older="hasOlder"
          :loading-older="loadingOlder"
          :tool-calls="toolCalls"
          :tool-renderers="toolRenderers"
          @older="older"
        >
          <template #content="scope">
            <slot name="content" v-bind="scope">
              <!-- Inspect 的结构化载荷统一走无卡片 JSON 树；对话侧仍使用内容渲染器。 -->
              <JsonView
                v-if="
                  scope.section === 'input' ||
                  scope.section === 'output' ||
                  scope.section === 'raw' ||
                  scope.section === 'schema'
                "
                :value="scope.value"
                plain
              />
              <ContentRenderer
                v-else
                :value="scope.value"
                :client="client"
                :tool-calls="toolCalls"
                :tool-renderers="toolRenderers"
              />
            </slot>
          </template>
        </ExecutionView>
      </Tabs.Panel>
      <Tabs.Panel value="conversation" class="dt-conversation-panel">
        <AgentConversation
          :key="selectedSessionId"
          :client="client"
          :messages="messages"
          :tool-calls="toolCalls"
          :auto-scroll="autoScroll"
          :active="tab === 'conversation'"
          empty-text="开始观看后，对话会出现在这里。"
          :tool-renderers="toolRenderers"
          :message-renderers="messageRenderers"
        >
          <template #content="scope">
            <slot name="content" v-bind="scope">
              <ContentRenderer
                :value="scope.value"
                :final="scope.entry.status !== 'running'"
                :client="client"
                :tool-calls="toolCalls"
                :tool-renderers="toolRenderers"
              />
            </slot>
          </template>
        </AgentConversation>
      </Tabs.Panel>
      <SessionStatusBar :session="selectedSession" />
    </Tabs.Root>
  </section>
</template>
