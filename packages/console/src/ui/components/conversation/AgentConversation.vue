<script setup lang="ts">
import type { TraceClient } from '@cieljs/trace/client';
import type { TraceEntry } from '@cieljs/trace/protocol';
import { Button } from '@vuetify/v0/components';
import { onMounted, useTemplateRef, watch } from 'vue';

import { vFollowScroll } from '../../directives/follow-scroll.ts';
import type { MessageRenderers } from '../../message-renderers.ts';
import type { ToolRenderers } from '../../tool-renderers.ts';
import type { ToolCallRecord } from '../../utils/tool-calls.ts';
import ContentRenderer from '../content/ContentRenderer.vue';
import MessageView from './MessageView.vue';

const props = withDefaults(
  defineProps<{
    client: TraceClient;
    messages: TraceEntry[];
    toolCalls: ReadonlyMap<string, ToolCallRecord>;
    autoScroll?: boolean;
    active?: boolean;
    emptyText?: string;
    toolRenderers?: ToolRenderers;
    messageRenderers?: MessageRenderers;
  }>(),
  {
    autoScroll: true,
    active: true,
    emptyText: '还没有对话。',
  },
);

const conversation = useTemplateRef<HTMLElement>('conversation');

function jumpToBottom() {
  const element = conversation.value;

  if (!element) {
    return;
  }

  element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
}

/** 面板重新显示时保持用户主动滚离底部的状态，只校正仍在跟随的视图。 */
function stickToBottom() {
  const element = conversation.value;

  if (!element || element.hasAttribute('data-detached')) {
    return;
  }

  let remaining = 6;

  const step = () => {
    const target = conversation.value;

    if (!target) {
      return;
    }

    target.scrollTop = target.scrollHeight;

    if (--remaining > 0) {
      requestAnimationFrame(step);
    }
  };

  step();
}

onMounted(() => {
  if (props.active) {
    stickToBottom();
  }
});

watch(
  () => props.active,
  active => {
    if (active) {
      stickToBottom();
    }
  },
);
</script>

<template>
  <div ref="conversation" v-follow-scroll="autoScroll" class="dt-conversation">
    <p v-if="!messages.length" class="dt-empty">{{ emptyText }}</p>
    <MessageView
      v-for="entry in messages"
      :key="entry.id"
      :client="client"
      :entry="entry"
      :tool-calls="toolCalls"
      :tool-renderers="toolRenderers"
      :message-renderers="messageRenderers"
    >
      <template #content="scope">
        <slot name="content" v-bind="scope">
          <ContentRenderer
            :value="scope.value"
            :final="entry.status !== 'running'"
            :client="client"
            :tool-calls="toolCalls"
            :tool-renderers="toolRenderers"
          />
        </slot>
      </template>
    </MessageView>
  </div>
  <Button.Root
    class="dt-button dt-jump-bottom"
    aria-label="返回底部"
    title="返回底部"
    @click="jumpToBottom"
  >
    返回底部
  </Button.Root>
</template>
