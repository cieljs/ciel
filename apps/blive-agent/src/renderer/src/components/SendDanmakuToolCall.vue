<script setup lang="ts">
import type { ToolRendererProps } from 'cieljs/console';
import { computed } from 'vue';

const props = defineProps<ToolRendererProps>();

/** 工具结果是联合类型，这里只按状态取文案，字段缺失时统一回落到「已返回」。 */
const Outcome: Record<string, string> = {
  submitted: '已提交到页面',
  simulated: '模拟发送',
  deferred: '已暂缓',
};

const args = computed(
  () => (props.args ?? {}) as { action?: string; content?: string; reason?: string },
);

const details = computed(() => {
  const { result } = props;

  if (!result || typeof result !== 'object' || !('details' in result)) {
    return {};
  }

  const value = (result as { details?: unknown }).details;

  return (value && typeof value === 'object' ? value : {}) as { status?: unknown };
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

  const { status } = details.value;

  return (typeof status === 'string' ? Outcome[status] : undefined) ?? '已返回';
});
</script>

<template>
  <div class="watch-danmaku" :data-status="status">
    <div class="watch-danmaku-heading">
      <span>{{ args.action === 'send' ? '弹幕内容' : '本轮暂缓' }}</span>
      <span>{{ outcome }}</span>
    </div>
    <p v-if="args.content" class="watch-danmaku-content">{{ args.content }}</p>
    <p v-if="args.reason" class="watch-danmaku-reason">{{ args.reason }}</p>
    <p v-if="loadError" class="dt-error">{{ loadError }}</p>
  </div>
</template>

<style scoped>
.watch-danmaku {
  display: grid;
  gap: 8px;
  line-height: 1.8;
}
.watch-danmaku p {
  margin: 0;
  overflow-wrap: anywhere;
}
.watch-danmaku-heading {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 6px 12px;
  color: var(--dt-muted);
  font-size: 10px;
}
.watch-danmaku-content {
  border-left: 2px solid var(--dt-accent);
  padding: 2px 0 2px 10px;
  color: var(--dt-text);
  font-size: 13px;
}
.watch-danmaku-reason {
  color: var(--dt-muted);
  font-size: 11px;
}
.watch-danmaku[data-status='error'] .watch-danmaku-heading {
  color: #ffadb9;
}
</style>
