<script setup lang="ts">
import type { TraceSession } from '@cieljs/trace/protocol';
import { Popover } from '@vuetify/v0/components';
import { computed } from 'vue';

import { cacheHitRate, formatPercent, formatTokens } from '../../utils/usage.ts';

const props = defineProps<{
  session?: TraceSession;
}>();

const usage = computed(() => props.session?.usage);
</script>

<template>
  <Popover.Root position-area="top" position-try="most-width top">
    <div class="dt-session-status">
      <Popover.Activator class="dt-session-status-trigger">
        <span class="dt-session-progress">
          第 {{ session?.turn ?? 0 }} 轮 · 共 {{ session?.steps ?? 0 }} 步
        </span>
        <span v-if="usage" class="dt-session-usage-summary">
          {{ formatTokens(usage.total.total) }} tok · 缓存命中
          {{ formatPercent(cacheHitRate(usage.total)) }} · 上下文
          {{ formatTokens(usage.context?.total ?? 0) }}
        </span>
        <span v-else class="dt-session-usage-summary">暂无用量</span>
      </Popover.Activator>
    </div>

    <Popover.Content class="dt-session-metrics">
      <template v-if="usage">
        <div class="dt-metric-primary">
          <span>Token 用量</span>
          <strong>{{ formatTokens(usage.total.total) }} tok</strong>
        </div>
        <dl>
          <dt>缓存命中</dt>
          <dd>{{ formatPercent(cacheHitRate(usage.total)) }}</dd>
          <dt>当前上下文</dt>
          <dd>{{ formatTokens(usage.context?.total ?? 0) }} tok</dd>
          <dt>未缓存输入</dt>
          <dd>{{ formatTokens(usage.total.input) }} tok</dd>
          <dt v-if="usage.total.cacheWrite">缓存写入</dt>
          <dd v-if="usage.total.cacheWrite">{{ formatTokens(usage.total.cacheWrite) }} tok</dd>
          <dt>缓存读取</dt>
          <dd>{{ formatTokens(usage.total.cacheRead) }} tok</dd>
          <dt>输出</dt>
          <dd>{{ formatTokens(usage.total.output) }} tok</dd>
        </dl>
      </template>
      <p v-else class="dt-empty">当前没有可用的 Session 用量。</p>
    </Popover.Content>
  </Popover.Root>
</template>
