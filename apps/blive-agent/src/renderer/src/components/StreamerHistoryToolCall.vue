<script setup lang="ts">
import type { ToolRendererProps } from 'cieljs/console';
import { computed } from 'vue';

const props = defineProps<ToolRendererProps>();

/** 与 bilibili/api.ts 的 StreamerHistoryItem 同形，字段缺失时逐项回落。 */
interface HistoryItem {
  id?: string;
  type?: string;
  title?: string;
  /** Bilibili 返回的 unix 秒。 */
  publishedAt?: number;
  pinned?: boolean;
  summary?: string;
}

const items = computed<HistoryItem[]>(() => {
  const { result } = props;

  if (!result || typeof result !== 'object' || !('details' in result)) {
    return [];
  }

  const { details } = result as { details?: unknown };

  if (!details || typeof details !== 'object' || !('items' in details)) {
    return [];
  }

  const { items: list } = details as { items?: unknown };

  return Array.isArray(list) ? (list as HistoryItem[]) : [];
});

const outcome = computed(() => {
  if (props.loadError) {
    return '结果加载失败';
  }

  if (props.status === 'running') {
    return '执行中…';
  }

  if (props.status === 'error') {
    return '执行失败';
  }

  if (!items.value.length) {
    return '暂无内容';
  }

  return `${items.value.length} 条 · 公开资料`;
});

/** 列表里的时间只保留到分钟，逐年跨月的绝对时间对读对话没有帮助。 */
function formatPublishedAt(seconds: number | undefined) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return '';
  }

  const date = new Date(seconds * 1_000);
  const pad = (value: number) => value.toString().padStart(2, '0');

  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
</script>

<template>
  <div class="flex flex-col gap-1.5 text-[11px]">
    <p class="text-muted">{{ outcome }}</p>
    <ul v-if="items.length" class="flex flex-col gap-1.5">
      <li v-for="(item, index) in items" :key="item.id ?? index" class="flex flex-col gap-0.5">
        <p class="flex items-center gap-1.5">
          <span
            v-if="item.pinned"
            class="text-accent rounded-[5px] bg-[#fb729915] px-1.5 py-0.5 text-[10px]"
            >置顶</span
          >
          <span class="min-w-0 flex-1 truncate" :title="item.title">{{
            item.title || '（无标题）'
          }}</span>
          <span class="text-muted shrink-0">{{ item.type === 'video' ? '视频' : '动态' }}</span>
          <span v-if="formatPublishedAt(item.publishedAt)" class="text-muted shrink-0 tabular-nums">
            {{ formatPublishedAt(item.publishedAt) }}
          </span>
        </p>
        <p v-if="item.summary" class="text-muted line-clamp-2 break-all">{{ item.summary }}</p>
      </li>
    </ul>
  </div>
</template>
