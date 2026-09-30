<script setup lang="ts">
import type { TraceClient } from '@cieljs/trace/client';
import { computed, shallowRef, watch } from 'vue';

import { useConsole } from '../../composables/use-console.ts';
import type { ToolRenderers } from '../../tool-renderers.ts';
import { indexToolCalls, type ToolCallRecord } from '../../utils/tool-calls.ts';
import ContentRenderer from '../content/ContentRenderer.vue';
import JsonView from '../content/JsonView.vue';
import ExecutionView from './ExecutionView.vue';

const props = defineProps<{
  client: TraceClient;
  sessionId: string;
  toolRenderers?: ToolRenderers;
}>();

const { entries, steps, error, hasOlder, loadingOlder, older, selectSession } = useConsole(
  props.client,
);

const query = shallowRef('');

let indexed: Map<string, ToolCallRecord> | undefined;
const toolCalls = computed(() => (indexed = indexToolCalls(entries.value, indexed)));

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
  <section class="ciel-console dt-execution-panel" aria-label="Agent 轨迹">
    <p v-if="error" class="dt-error">{{ error }}</p>
    <ExecutionView
      :key="sessionId"
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
  </section>
</template>
