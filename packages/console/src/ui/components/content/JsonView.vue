<script setup lang="ts">
import { Button } from '@vuetify/v0/components';
import { computed, onBeforeUnmount, shallowRef } from 'vue';
import VueJsonPretty from 'vue-json-pretty';

import { jsonSafe, jsonText } from '../../utils/content-format.ts';

/** 库只导出默认组件，JSONDataType 没有公开导出，这里按同一形状本地声明，用来收窄 unknown。 */
type JsonData = string | number | boolean | unknown[] | Record<string, unknown> | null;

const props = withDefaults(
  defineProps<{
    value: unknown;
    /** 默认展开层数。调用方传常量，跟着响应式变化会让展开状态每次重渲染都复位。 */
    deep?: number;
    /** Inspect 面板已有自己的容器，只需要 JSON 树本身。 */
    plain?: boolean;
  }>(),
  { deep: 4, plain: false },
);

// jsonSafe 已经剥掉 BigInt 与循环引用；computed 让同一份值保持稳定的引用，
// 否则每次重渲染都会换成新对象，树里手动展开/收起的节点会被重置。
const data = computed(() => jsonSafe(props.value) as JsonData);

const copied = shallowRef(false);
let resetTimer: ReturnType<typeof setTimeout> | undefined;

/** Electron 窗口失焦时 navigator.clipboard 会直接拒绝，退回到一次性文本框选中复制。 */
async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);

    return;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

async function copy(): Promise<void> {
  await writeClipboard(jsonText(props.value));
  copied.value = true;
  clearTimeout(resetTimer);
  resetTimer = setTimeout(() => (copied.value = false), 1500);
}

onBeforeUnmount(() => clearTimeout(resetTimer));
</script>

<template>
  <div class="dt-json" :class="{ 'dt-json-plain': plain }">
    <div class="dt-json-toolbar">
      <span class="dt-json-note">JSON · 展开 {{ deep }} 层</span>
      <Button.Root
        class="dt-button dt-json-copy"
        :aria-label="copied ? '已复制原始 JSON' : '复制原始 JSON'"
        @click="copy"
      >
        {{ copied ? '已复制' : '复制' }}
      </Button.Root>
    </div>
    <VueJsonPretty
      :data="data"
      :deep="deep"
      :show-length="true"
      :show-line="true"
      :show-line-number="true"
      theme="dark"
    />
  </div>
</template>
