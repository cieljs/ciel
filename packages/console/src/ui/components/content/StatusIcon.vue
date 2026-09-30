<script setup lang="ts">
import type { TraceEntry } from '@cieljs/trace/protocol';

defineProps<{ status: TraceEntry['status'] }>();
const labels = { running: '执行中', completed: '已完成', error: '失败' } as const;
</script>

<template>
  <svg
    class="dt-status-icon"
    :data-status="status"
    :aria-label="labels[status]"
    role="img"
    width="13"
    height="13"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <title>{{ labels[status] }}</title>
    <path v-if="status === 'completed'" d="m3 8 3 3 7-7" />
    <path v-else-if="status === 'error'" d="m4 4 8 8M12 4l-8 8" />
    <template v-else>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 4.5V8l2.5 1.5" />
    </template>
  </svg>
</template>
