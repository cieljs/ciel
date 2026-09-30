<script setup lang="ts">
import type { TraceClient } from '@cieljs/trace/client';
import type { TraceEntry } from '@cieljs/trace/protocol';
import MarkdownRender from 'markstream-vue';
import { computed, type Component } from 'vue';

import { useTraceValue } from '../../composables/use-trace-value.ts';
import type { ToolRendererProps } from '../../tool-renderers.ts';
import { readableText } from '../../utils/content-format.ts';
import {
  toolCallStatus,
  toolResultEntry,
  toolResultPayload,
  toolResultText,
} from '../../utils/tool-calls.ts';
import Disclosure from './Disclosure.vue';
import JsonView from './JsonView.vue';
import StatusIcon from './StatusIcon.vue';

const props = defineProps<{
  client?: TraceClient;
  call?: TraceEntry;
  result?: TraceEntry;
  block?: { id: string; name?: string; arguments?: unknown };
  renderer?: Component;
  /** 执行记录用步骤自身状态覆盖，避免工具条目缺失时误判为运行中。 */
  status?: 'running' | 'completed' | 'error';
}>();

const name = computed(() => props.block?.name ?? props.call?.name ?? '工具');

const status = computed(
  () => props.status ?? toolCallStatus({ call: props.call, result: props.result }),
);

const title = computed(() => props.call?.label ?? name.value);

// 对话视图的 arguments 与工具条目的 input 同源，直接用它就不必再发一次请求。
const needsInput = computed(
  () => props.block?.arguments === undefined && Boolean(props.call?.input),
);

const { value: input } = useTraceValue(
  () => props.client,
  () => props.call,
  () => (needsInput.value ? 'input' : undefined),
);

const args = computed(() => props.block?.arguments ?? input.value);

const {
  value: result,
  loading,
  error: loadError,
} = useTraceValue(
  () => props.client,
  () => toolResultEntry({ call: props.call, result: props.result }),
  () => 'output',
);

const payload = computed(() => toolResultPayload(result.value));
const payloadText = computed(() => toolResultText(payload.value));

const rendererProps = computed<ToolRendererProps>(() => ({
  name: name.value,
  label: props.call?.label,
  description: props.call?.description,
  status: status.value,
  toolCallId: props.block?.id ?? props.call?.toolCallId ?? '',
  args: args.value,
  result: result.value,
  loading: loading.value,
  loadError: loadError.value,
}));
</script>

<template>
  <Disclosure :title="title" class="dt-tool-section" :data-status="status">
    <template #trailing><StatusIcon class="dt-tool-status" :status="status" /></template>
    <div class="dt-tool-call">
      <component v-if="renderer" :is="renderer" v-bind="rendererProps" />
      <template v-else>
        <p v-if="call?.description" class="dt-tool-note">{{ call.description }}</p>
        <p class="dt-tool-part">参数</p>
        <JsonView v-if="args !== undefined" :value="args" :deep="2" />
        <p v-else class="dt-tool-note">无参数</p>
        <p class="dt-tool-part">结果</p>
        <p v-if="loading" class="dt-tool-note">生成中…</p>
        <p v-else-if="loadError" class="dt-error">{{ loadError }}</p>
        <MarkdownRender
          v-else-if="payloadText !== undefined"
          :content="readableText(payloadText)"
          :is-dark="true"
          html-policy="escape"
        />
        <JsonView v-else-if="payload !== undefined" :value="payload" :deep="2" />
        <p v-else class="dt-tool-note">暂无输出</p>
      </template>
    </div>
  </Disclosure>
</template>
