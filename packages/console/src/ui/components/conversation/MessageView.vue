<script setup lang="ts">
import type { TraceClient } from '@cieljs/trace/client';
import type { TraceEntry } from '@cieljs/trace/protocol';
import { computed } from 'vue';

import { useTraceValue } from '../../composables/use-trace-value.ts';
import type { MessageRendererProps, MessageRenderers } from '../../message-renderers.ts';
import { messageRenderer } from '../../message-renderers.ts';
import type { ToolRenderers } from '../../tool-renderers.ts';
import {
  hasMessageContent,
  messageFallback,
  messageText,
  wholeJson,
} from '../../utils/content-format.ts';
import type { ToolCallRecord } from '../../utils/tool-calls.ts';
import ContentRenderer from '../content/ContentRenderer.vue';
import StatusIcon from '../content/StatusIcon.vue';

const props = defineProps<{
  client: TraceClient;
  entry: TraceEntry;
  toolCalls?: ReadonlyMap<string, ToolCallRecord>;
  toolRenderers?: ToolRenderers;
  /** 命中谓词的消息交给宿主组件渲染，其余走默认渲染。 */
  messageRenderers?: MessageRenderers;
}>();

const { value, error, loading } = useTraceValue(
  () => props.client,
  () => props.entry,
  () => 'output',
);

// 时间与来源共用一行，正文不再被重复的角色标题打断。
const clock = computed(() =>
  new Date(props.entry.startedAt).toLocaleTimeString('zh-CN', { hour12: false }),
);

const text = computed(() => messageText(value.value));

const hasContent = computed(
  () => props.entry.name !== 'assistant' || hasMessageContent(value.value),
);

const fallback = computed(() => messageFallback(value.value));
const json = computed(() => (text.value === undefined ? undefined : wholeJson(text.value)));

const renderer = computed(() =>
  messageRenderer(
    { name: props.entry.name, label: props.entry.label, text: text.value ?? '', json: json.value },
    props.messageRenderers,
  ),
);

const rendererProps = computed<MessageRendererProps>(() => ({
  name: props.entry.name,
  label: props.entry.label,
  text: text.value ?? '',
  json: json.value,
  model: props.entry.model?.name,
  status: props.entry.status,
}));
</script>

<template>
  <article class="dt-message" :data-role="entry.name" :data-status="entry.status">
    <header class="dt-message-meta">
      <span class="dt-message-marker" aria-hidden="true" />
      <span v-if="entry.label" class="dt-message-note">{{ entry.label }}</span>
      <time :datetime="new Date(entry.startedAt).toISOString()">{{ clock }}</time>
      <StatusIcon
        v-if="entry.status !== 'completed'"
        class="dt-message-state"
        :status="entry.status"
      />
    </header>
    <p v-if="error" class="dt-error">{{ error }}</p>
    <div
      v-else-if="entry.status === 'running' && !hasContent"
      class="dt-message-skeleton"
      role="status"
      aria-label="正在生成"
    >
      <span />
      <span />
      <span />
    </div>
    <p v-else-if="loading && value === undefined" class="dt-message-loading">正在读取内容…</p>
    <component v-else-if="renderer && hasContent" :is="renderer" v-bind="rendererProps" />
    <p v-else-if="!hasContent" class="dt-message-placeholder">{{ fallback }}</p>
    <slot
      v-else
      name="content"
      :entry="entry"
      section="output"
      :value="value"
      :default-renderer="ContentRenderer"
    >
      <ContentRenderer
        :value="value"
        :final="entry.status !== 'running'"
        :client="client"
        :tool-calls="toolCalls"
        :tool-renderers="toolRenderers"
      />
    </slot>
  </article>
</template>
