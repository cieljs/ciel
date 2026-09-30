<script setup lang="ts">
import type { MessageRendererProps } from 'cieljs/console';
import { computed } from 'vue';

const props = defineProps<MessageRendererProps>();

/** 只读取决策协议里的展示字段，字段缺失时逐项回落，不替模型补值。 */
interface RoomDecision {
  action?: string;
  confidence?: number;
  danmakuAction?: string;
  evidence?: string[];
  reason?: string;
  score?: number;
}

const decision = computed(() => (props.json ?? {}) as RoomDecision);

const exploring = computed(() => decision.value.action === 'explore');

const confidence = computed(() => {
  const value = decision.value.confidence;

  return typeof value === 'number' ? `${Math.round(value * 100)}%` : '';
});

const evidence = computed(() =>
  (decision.value.evidence ?? []).filter(item => typeof item === 'string'),
);
</script>

<template>
  <div class="watch-decision">
    <div class="watch-decision-heading">
      <strong :class="{ exploring }">{{ exploring ? '考虑换台' : '继续观看' }}</strong>
      <span class="watch-decision-metric" v-if="decision.score !== undefined"
        >评分 <b>{{ decision.score }}</b></span
      >
      <span class="watch-decision-metric" v-if="confidence"
        >信心 <b>{{ confidence }}</b></span
      >
    </div>
    <p v-if="decision.reason" class="watch-decision-reason">{{ decision.reason }}</p>
    <ul v-if="evidence.length" class="watch-decision-evidence">
      <li v-for="(item, index) in evidence" :key="index">{{ item }}</li>
    </ul>
    <p v-if="decision.danmakuAction" class="watch-decision-footer">
      <span class="watch-decision-dot" aria-hidden="true" />
      {{ decision.danmakuAction === 'send' ? '准备发送弹幕' : '暂缓弹幕，继续观察' }}
    </p>
  </div>
</template>

<style scoped>
.watch-decision {
  display: grid;
  gap: 9px;
  font-size: 12px;
  line-height: 1.8;
}
.watch-decision p {
  margin: 0;
}
.watch-decision-heading {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 5px 14px;
}
.watch-decision-heading strong {
  margin-right: auto;
  color: var(--dt-text);
  font-size: 13px;
  font-weight: 600;
}
.watch-decision-heading strong.exploring {
  color: var(--dt-accent);
}
.watch-decision-metric {
  color: var(--dt-muted);
  font-size: 10px;
  white-space: nowrap;
}
.watch-decision-metric b {
  margin-left: 3px;
  color: var(--dt-text);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.watch-decision-reason {
  color: var(--dt-text);
  overflow-wrap: anywhere;
}
.watch-decision-evidence {
  display: grid;
  gap: 3px;
  margin: 0;
  padding-left: 16px;
  color: var(--dt-muted);
  font-size: 11px;
}
.watch-decision-evidence li::marker {
  color: color-mix(in srgb, var(--dt-accent) 45%, var(--dt-muted));
}
.watch-decision-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--dt-muted);
  font-size: 10px;
}
.watch-decision-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.65;
}
</style>
