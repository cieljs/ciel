<script setup lang="ts">
import { CielChat, vFollowScroll } from '@cieljs/console';
import type { TraceClient } from '@cieljs/trace';
import { Button } from '@vuetify/v0/components';
import { computed, onMounted, shallowRef, useTemplateRef } from 'vue';

import { useInvestigationChat } from '../composables/use-investigation-chat.ts';
import { useInvestigationSidebar } from '../composables/use-investigation-sidebar.ts';
import type { InvestigationClient, InvestigationRoom, InvestigationTargetInput } from '../types.ts';
import InvestigationComposer from './InvestigationComposer.vue';
import InvestigationSidebar from './InvestigationSidebar.vue';

const props = defineProps<{
  client: InvestigationClient;
  traceClient: TraceClient;
  currentRoom?: InvestigationRoom;
}>();

const sidebarCollapsed = defineModel<boolean>('sidebarCollapsed', { default: false });

const {
  conversations,
  conversation,
  pending,
  sessionPending,
  error,
  initialize,
  create,
  select,
  rename,
  remove,
  prompt,
  abort,
} = useInvestigationChat(props.client);

const { width, maxWidth, dragging, startDrag, moveDrag, endDrag, keyboardResize } =
  useInvestigationSidebar();

const scroll = useTemplateRef<HTMLElement>('scroll');
const editingTitle = shallowRef(false);
const title = shallowRef('');

const currentSessionPending = computed(() => {
  const sessionId = conversation.value?.sessionId;

  return sessionId ? sessionPending.value.get(sessionId) : undefined;
});

const busySessionIds = computed<ReadonlySet<string>>(() => new Set(sessionPending.value.keys()));
const composerRunning = computed(() => Boolean(currentSessionPending.value));

const composerDisabled = computed(() => {
  if (!conversation.value) {
    return true;
  }

  if (pending.value) {
    return true;
  }

  return currentSessionPending.value === 'abort';
});

function createConversation(target: InvestigationTargetInput) {
  void create(target);
}

function startTitleEdit() {
  title.value = conversation.value?.title ?? '';
  editingTitle.value = true;
}

function saveTitle() {
  editingTitle.value = false;

  if (title.value.trim()) {
    void rename(title.value);
  }
}

function cancelTitleEdit() {
  editingTitle.value = false;
}

function jumpToBottom() {
  const element = scroll.value;

  if (!element) {
    return;
  }

  element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
}

onMounted(() => {
  void initialize();
});
</script>

<template>
  <section
    class="investigation-chat"
    :class="{ collapsed: sidebarCollapsed, resizing: dragging }"
    :style="{ '--investigation-sidebar-width': `${width}px` }"
  >
    <InvestigationSidebar
      v-show="!sidebarCollapsed"
      :conversations="conversations"
      :selected-session-id="conversation?.sessionId"
      :current-room="currentRoom"
      :disabled="Boolean(pending)"
      :busy-session-ids="busySessionIds"
      @create="createConversation"
      @select="select"
      @delete="remove"
    />

    <div
      v-show="!sidebarCollapsed"
      class="investigation-resizer"
      role="separator"
      tabindex="0"
      aria-label="调整调查侧边栏宽度"
      aria-orientation="vertical"
      aria-controls="investigation-sidebar"
      :aria-valuenow="width"
      :aria-valuemin="176"
      :aria-valuemax="maxWidth"
      @pointerdown="startDrag"
      @pointermove="moveDrag"
      @pointerup="endDrag"
      @pointercancel="endDrag"
      @lostpointercapture="endDrag"
      @keydown="keyboardResize"
    />

    <div class="investigation-workspace">
      <div ref="scroll" v-follow-scroll class="investigation-scroll">
        <header class="investigation-header">
          <div class="investigation-heading">
            <form v-if="editingTitle" @submit.prevent="saveTitle">
              <input
                v-model="title"
                class="investigation-title-input"
                maxlength="80"
                aria-label="调查标题"
                autofocus
                @blur="saveTitle"
                @keydown.esc.prevent="cancelTitleEdit"
              />
            </form>
            <Button.Root
              v-else
              class="investigation-title"
              :disabled="!conversation"
              title="修改标题"
              @click="startTitleEdit"
            >
              {{ conversation?.title ?? 'Investigation' }}
            </Button.Root>
            <span>{{ conversation?.label ?? '准备调查环境…' }}</span>
          </div>
        </header>

        <p v-if="error" class="investigation-error" role="alert">{{ error }}</p>

        <CielChat
          v-if="conversation"
          class="investigation-conversation"
          :client="traceClient"
          :session-id="conversation.sessionId"
          empty-text="这是一个新的调查。可以分析直播记录，也可以直接管理目标范围内的记忆。"
        />
        <div v-else class="investigation-empty">正在创建调查会话…</div>

        <InvestigationComposer
          :disabled="composerDisabled"
          :running="composerRunning"
          @submit="prompt"
          @abort="abort"
        />
      </div>

      <Button.Root
        class="investigation-jump-bottom"
        aria-label="返回底部"
        title="返回底部"
        @click="jumpToBottom"
      >
        返回底部
      </Button.Root>
    </div>
  </section>
</template>
