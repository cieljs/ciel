<script setup lang="ts">
import type { TraceClient } from '@cieljs/trace/client';
import { Button, Tabs } from '@vuetify/v0/components';
import { computed, shallowRef, watch } from 'vue';

import { useTraceValue, type TraceSection } from '../../composables/use-trace-value.ts';
import type { ToolRenderers } from '../../tool-renderers.ts';
import type { ToolCallRecord } from '../../utils/tool-calls.ts';
import { traceStepLabel, type TraceStepGroup } from '../../utils/trace-entries.ts';
import ContentRenderer from '../content/ContentRenderer.vue';
import Disclosure from '../content/Disclosure.vue';
import JsonView from '../content/JsonView.vue';
import StatusIcon from '../content/StatusIcon.vue';

const props = defineProps<{
  client: TraceClient;
  entry: TraceStepGroup;
  toolCalls?: ReadonlyMap<string, ToolCallRecord>;
  toolRenderers?: ToolRenderers;
}>();

defineEmits<{ close: [] }>();

type DetailTab = TraceSection | 'overview' | 'content' | 'thinking' | 'timing';

const tab = shallowRef<DetailTab>('overview');
const rawId = shallowRef('');
const isTool = computed(() => props.entry.kind === 'tool');

const inspected = computed(() => ({
  ...props.entry,
  raw: props.entry.events.find(event => event.id === rawId.value) ?? props.entry.raw,
}));

const activeSection = computed<TraceSection | undefined>(() => {
  if (['input', 'output', 'raw', 'schema'].includes(tab.value)) {
    return tab.value as TraceSection;
  }

  if (tab.value === 'overview' && props.entry.error) {
    return 'error';
  }
});

const { value, error, loading } = useTraceValue(
  () => props.client,
  () => inspected.value,
  () => activeSection.value,
);

const tabs = computed(() => {
  if (isTool.value) {
    return [
      { value: 'overview', label: '概览' },
      { value: 'input', label: '参数' },
      { value: 'output', label: '结果' },
      { value: 'schema', label: 'Schema' },
      { value: 'timing', label: '计时' },
      { value: 'raw', label: '原始事件' },
    ] satisfies Array<{ value: DetailTab; label: string }>;
  }

  const items: Array<{
    value: DetailTab;
    label: string;
  }> = [{ value: 'overview', label: '概览' }];

  if (props.entry.text) {
    items.push({ value: 'content', label: '消息' });
  }

  if (props.entry.thinking) {
    items.push({ value: 'thinking', label: '思考' });
  }

  items.push({ value: 'timing', label: '计时' }, { value: 'raw', label: '原始事件' });

  return items;
});

const payloadTabs = computed(() => tabs.value.filter(item => item.value !== 'overview'));

watch(
  () => props.entry.id,
  () => {
    rawId.value = '';

    const tabStillAvailable = tabs.value.some(item => item.value === tab.value);

    if (!tabStillAvailable) {
      tab.value = 'overview';
    }
  },
);

function elapsed() {
  const reference = props.entry.endedAt ?? props.entry.runningUntil ?? props.entry.updatedAt;

  return Math.max(0, reference - props.entry.startedAt);
}
</script>

<template>
  <div class="dt-detail">
    <Tabs.Root v-model="tab">
      <div class="dt-detail-toolbar">
        <Button.Root class="dt-button dt-close" aria-label="关闭详情" @click="$emit('close')">
          ×
        </Button.Root>
        <Tabs.List class="dt-tabs" aria-label="步骤详情">
          <Tabs.Item v-for="item in tabs" :key="item.value" :value="item.value" class="dt-tab">
            {{ item.label }}
          </Tabs.Item>
        </Tabs.List>
      </div>
      <p v-if="error" class="dt-error">{{ error }}</p>
      <Tabs.Panel value="overview" class="dt-detail-body">
        <section v-if="entry.status === 'error'" class="dt-error-detail">
          <strong>错误详情</strong>
          <p v-if="loading" class="dt-empty">加载中…</p>
          <JsonView v-else-if="value !== undefined" :value="value" plain />
          <p v-else class="dt-error">执行失败，请查看输出或原始事件。</p>
        </section>
        <Disclosure :title="isTool ? '工具调用' : 'Agent 轨迹'">
          <dl>
            <dt>名称</dt>
            <dd>{{ traceStepLabel(entry) }}</dd>
            <dt>状态</dt>
            <dd><StatusIcon :status="entry.status" /></dd>
            <dt>时间</dt>
            <dd>{{ new Date(entry.startedAt).toLocaleTimeString() }}</dd>
            <dt>记录 ID</dt>
            <dd>{{ entry.id }}</dd>
            <dt>Session</dt>
            <dd>{{ entry.sessionId }}</dd>
            <dt>Run</dt>
            <dd>{{ entry.runId }}</dd>
            <dt>Turn</dt>
            <dd>{{ entry.turnNumber ? `第 ${entry.turnNumber} 轮` : (entry.turnId ?? '—') }}</dd>
            <dt v-if="entry.toolCallId">Tool call</dt>
            <dd v-if="entry.toolCallId">{{ entry.toolCallId }}</dd>
            <dt v-if="entry.messageId">Message</dt>
            <dd v-if="entry.messageId">{{ entry.messageId }}</dd>
            <dt v-if="isTool && entry.description">描述</dt>
            <dd v-if="isTool && entry.description" class="dt-tool-description">
              {{ entry.description }}
            </dd>
          </dl>
        </Disclosure>
        <Disclosure v-if="!isTool && entry.model" title="模型">
          <JsonView :value="entry.model" plain />
        </Disclosure>
      </Tabs.Panel>
      <Tabs.Panel
        v-for="item in payloadTabs"
        :key="item.value"
        :value="item.value"
        class="dt-detail-body dt-payload"
        :class="{ 'dt-json-payload': item.value === 'raw' || item.value === 'schema' }"
      >
        <template v-if="tab === item.value">
          <div v-if="item.value === 'timing'" class="dt-timing">
            <dl>
              <dt>开始时间</dt>
              <dd>{{ new Date(entry.startedAt).toLocaleString() }}</dd>
              <dt>结束时间</dt>
              <dd>{{ entry.endedAt ? new Date(entry.endedAt).toLocaleString() : '执行中' }}</dd>
              <dt>耗时</dt>
              <dd>{{ elapsed() }} 毫秒</dd>
              <dt>计时来源</dt>
              <dd>Agent 事件时间戳</dd>
            </dl>
          </div>
          <div v-else-if="item.value === 'thinking'" class="dt-agent-thinking">
            <ContentRenderer v-if="entry.thinking" :value="entry.thinking" />
            <p v-else class="dt-empty">此 Agent 步骤没有思考内容</p>
          </div>
          <div v-else-if="item.value === 'content'" class="dt-agent-content">
            <ContentRenderer v-if="entry.text" :value="entry.text" />
            <p v-else class="dt-empty">此 Agent 步骤没有消息内容</p>
          </div>
          <label
            v-else-if="item.value === 'raw' && entry.events.length > 1"
            class="dt-event-selector"
          >
            原始事件（{{ entry.events.length }}）
            <select v-model="rawId">
              <option value="">最新事件</option>
              <option v-for="(event, index) in entry.events" :key="event.id" :value="event.id">
                {{ index + 1 }} · {{ event.preview }}
              </option>
            </select>
          </label>
          <p
            v-if="
              item.value !== 'content' &&
              item.value !== 'thinking' &&
              item.value !== 'timing' &&
              loading
            "
            class="dt-empty"
          >
            加载中…
          </p>
          <p
            v-else-if="
              item.value !== 'content' &&
              item.value !== 'thinking' &&
              item.value !== 'timing' &&
              value === undefined
            "
            class="dt-empty"
          >
            此步骤没有该内容
          </p>
          <slot
            v-else-if="
              item.value !== 'content' && item.value !== 'thinking' && item.value !== 'timing'
            "
            name="content"
            :entry="entry"
            :section="activeSection"
            :value="value"
            :default-renderer="ContentRenderer"
          >
            <!-- 原始事件是排查用的完整载荷，代码块读不出折叠与行号，这里换成 JSON 树。 -->
            <JsonView
              v-if="
                item.value === 'input' ||
                item.value === 'output' ||
                item.value === 'raw' ||
                item.value === 'schema'
              "
              :value="value"
              plain
            />
            <ContentRenderer v-else :value="value" />
          </slot>
        </template>
      </Tabs.Panel>
    </Tabs.Root>
  </div>
</template>

<style scoped>
.dt-error-detail {
  padding: 12px;
}

.dt-error-detail > strong {
  color: #ffadb9;
  font-size: 12px;
}
</style>
