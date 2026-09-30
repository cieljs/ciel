<script setup lang="ts">
import { Button } from '@vuetify/v0/components';

import type { TraceStepGroup } from '../../utils/trace-entries.ts';
import { traceActor, traceStepLabel } from '../../utils/trace-entries.ts';
import StatusIcon from '../content/StatusIcon.vue';

const props = defineProps<{ entries: TraceStepGroup[]; selectedId: string }>();
defineEmits<{ select: [entry: TraceStepGroup] }>();

function duration(entry: TraceStepGroup) {
  // 未结束分组用 runningUntil（所在 run 最后一次事件）定格，不读墙上时钟。
  const reference = entry.endedAt ?? entry.runningUntil ?? entry.updatedAt;
  const elapsed = Math.max(0, reference - entry.startedAt);
  const value = elapsed < 1000 ? `${Math.round(elapsed)} ms` : `${(elapsed / 1000).toFixed(1)} s`;

  return entry.status === 'running' ? `${value}…` : value;
}

function beginsRound(index: number) {
  const round = props.entries[index]?.turnNumber;

  if (!round) {
    return false;
  }

  return props.entries[index - 1]?.turnNumber !== round;
}
</script>

<template>
  <div class="dt-list">
    <div class="dt-list-heading">
      <span aria-hidden="true" />
      <span class="dt-step-name">名称</span>
      <span class="dt-step-status">状态</span>
      <span class="dt-start-time">开始时间</span>
      <span class="dt-duration">耗时</span>
    </div>
    <template v-for="(entry, index) in entries" :key="entry.id">
      <div v-if="beginsRound(index)" class="dt-turn-divider">
        <span class="dt-turn-badge">第 {{ entry.turnNumber }} 轮</span>
      </div>
      <Button.Root
        class="dt-row"
        :class="{ selected: selectedId === entry.id }"
        :data-status="entry.status"
        :aria-pressed="selectedId === entry.id"
        @click="$emit('select', entry)"
      >
        <span class="dt-actor-tag" :data-actor="traceActor(entry)">
          {{ traceActor(entry) }}
        </span>
        <span class="dt-step-name" :title="traceStepLabel(entry)">
          {{ traceStepLabel(entry) }}
          <small v-if="entry.runId" class="dt-step-context">
            运行 {{ entry.runId.slice(-6) }}
          </small>
        </span>
        <StatusIcon class="dt-step-status" :status="entry.status" />
        <time
          class="dt-start-time"
          :datetime="new Date(entry.startedAt).toISOString()"
          :title="new Date(entry.startedAt).toLocaleString()"
        >
          {{ new Date(entry.startedAt).toLocaleTimeString('zh-CN', { hour12: false }) }}
        </time>
        <span class="dt-duration" :title="entry.status === 'running' ? '执行中' : '执行耗时'">
          {{ duration(entry) }}
        </span>
      </Button.Root>
    </template>
    <p v-if="!entries.length" class="dt-empty">暂无轨迹步骤</p>
  </div>
</template>
