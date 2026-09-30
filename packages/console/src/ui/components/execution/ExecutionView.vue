<script setup lang="ts">
import type { TraceClient } from '@cieljs/trace/client';
import type { TraceEntry } from '@cieljs/trace/protocol';
import { Button } from '@vuetify/v0/components';
import { computed, nextTick, onMounted, onUnmounted, shallowRef, watch } from 'vue';

import { vFollowScroll } from '../../directives/follow-scroll.ts';
import type { ToolRenderers } from '../../tool-renderers.ts';
import type { ToolCallRecord } from '../../utils/tool-calls.ts';
import { groupTraceSteps } from '../../utils/trace-entries.ts';
import ContentRenderer from '../content/ContentRenderer.vue';
import JsonView from '../content/JsonView.vue';
import TraceDetail from './TraceDetail.vue';
import TraceList from './TraceList.vue';

const props = defineProps<{
  client: TraceClient;
  steps: TraceEntry[];
  hasOlder: boolean;
  loadingOlder: boolean;
  toolCalls?: ReadonlyMap<string, ToolCallRecord>;
  toolRenderers?: ToolRenderers;
}>();

const emit = defineEmits<{ older: [] }>();
const query = defineModel<string>('query', { required: true });

const selectedId = shallowRef('');
const grouped = computed(() => groupTraceSteps(props.steps));
const selected = computed(() => grouped.value.find(entry => entry.id === selectedId.value));

const filtered = computed(() =>
  grouped.value.filter(entry =>
    `${entry.label ?? ''} ${entry.name} ${entry.id} ${entry.sessionId} ${entry.toolCallId ?? ''}`
      .toLowerCase()
      .includes(query.value.toLowerCase()),
  ),
);

const split = shallowRef(36);
const listPanel = shallowRef<HTMLElement>();

function loadOlder(event: Event) {
  const element = event.currentTarget as HTMLElement;

  if (props.hasOlder && !props.loadingOlder && element.scrollTop < 80) {
    emit('older');
  }
}

function jumpToLatest() {
  const element = listPanel.value;

  if (!element) {
    return;
  }

  element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
}

function resize(event: PointerEvent) {
  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
}

function moveSplit(event: PointerEvent) {
  const handle = event.currentTarget as HTMLElement;

  if (!handle.hasPointerCapture(event.pointerId)) {
    return;
  }

  const bounds = handle.parentElement!.getBoundingClientRect();
  split.value = Math.max(20, Math.min(75, ((event.clientX - bounds.left) / bounds.width) * 100));
}

let resizeObserver: ResizeObserver | undefined;

/** 列表没铺满面板时继续补历史，避免高窗口或大量事件合并成少数行后下方留白。 */
async function fillViewport() {
  await nextTick();

  const element = listPanel.value;

  if (!element || element.clientHeight === 0) {
    return;
  }

  if (query.value || !props.hasOlder || props.loadingOlder) {
    return;
  }

  if (element.scrollHeight > element.clientHeight) {
    return;
  }

  emit('older');
}

onMounted(() => {
  const element = listPanel.value;

  if (!element) {
    return;
  }

  // 切到轨迹页或面板被拉高都会改变尺寸，这时同样要把列表补齐到铺满。
  resizeObserver = new ResizeObserver(() => void fillViewport());
  resizeObserver.observe(element);
  void fillViewport();
});

onUnmounted(() => resizeObserver?.disconnect());

watch(
  [() => props.steps, () => props.hasOlder, () => props.loadingOlder, query],
  () => void fillViewport(),
);
</script>

<template>
  <div class="dt-execution">
    <div class="dt-execution-head">
      <input
        v-model="query"
        class="dt-filter"
        type="search"
        aria-label="搜索轨迹"
        placeholder="搜索轨迹…"
      />
    </div>
    <div
      class="dt-network"
      :class="{ 'has-detail': selected }"
      :style="{ '--dt-split': `${split}%` }"
    >
      <div class="dt-trace-panel">
        <div ref="listPanel" v-follow-scroll class="dt-list-panel" @scroll.passive="loadOlder">
          <TraceList
            :entries="filtered"
            :selected-id="selectedId"
            @select="selectedId = $event.id"
          />
        </div>
        <Button.Root
          class="dt-button dt-jump-latest"
          aria-label="返回最新轨迹"
          title="返回最新轨迹"
          @click="jumpToLatest"
        >
          返回最新
        </Button.Root>
      </div>
      <div
        v-if="selected"
        class="dt-resizer"
        role="separator"
        aria-label="调整执行列表宽度"
        aria-orientation="vertical"
        :aria-valuenow="Math.round(split)"
        :aria-valuemin="20"
        :aria-valuemax="75"
        tabindex="0"
        @pointerdown="resize"
        @pointermove="moveSplit"
        @keydown.left.prevent="split = Math.max(20, split - 2)"
        @keydown.right.prevent="split = Math.min(75, split + 2)"
      />
      <TraceDetail
        v-if="selected"
        :client="client"
        :entry="selected"
        :tool-calls="toolCalls"
        :tool-renderers="toolRenderers"
        @close="selectedId = ''"
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
            <ContentRenderer v-else :value="scope.value" />
          </slot>
        </template>
      </TraceDetail>
    </div>
  </div>
</template>
