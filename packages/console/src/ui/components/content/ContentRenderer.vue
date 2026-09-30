<script setup lang="ts">
import type { TraceClient } from '@cieljs/trace/client';
import MarkdownRender from 'markstream-vue';
import { computed, shallowRef } from 'vue';

import type { ToolRenderers } from '../../tool-renderers.ts';
import {
  imageSource,
  jsonMarkdown,
  messageText,
  readableText,
} from '../../utils/content-format.ts';
import type { ToolCallRecord } from '../../utils/tool-calls.ts';
import Disclosure from './Disclosure.vue';
import ToolCallView from './ToolCallView.vue';

const props = withDefaults(
  defineProps<{
    value: unknown;
    final?: boolean;
    /** 以下三项用于把工具调用渲染成单个块；独立使用时可以不传，工具块只显示参数。 */
    client?: TraceClient;
    toolCalls?: ReadonlyMap<string, ToolCallRecord>;
    toolRenderers?: ToolRenderers;
  }>(),
  { final: true },
);

/** 感知帧是 1920×1080 拼图，对话里按缩略图展示，点击才能撑满面板。 */
const zoomed = shallowRef<number | null>(null);

const text = computed(() => messageText(props.value));

const blocks = computed(() => {
  const value = props.value;

  if (!value || typeof value !== 'object') {
    return [];
  }

  if ('type' in value && value.type === 'image') {
    return [value];
  }

  if ('content' in value && Array.isArray(value.content)) {
    return value.content;
  }

  return [];
});

const formattedText = computed(() => {
  if (text.value === undefined) {
    return undefined;
  }

  return readableText(text.value);
});
</script>

<template>
  <div class="dt-content">
    <MarkdownRender
      v-if="text !== undefined"
      :content="formattedText ?? ''"
      :is-dark="true"
      html-policy="escape"
      :final="final"
    />
    <template v-else-if="blocks.length">
      <template v-for="(block, index) in blocks" :key="index">
        <img
          v-if="block.type === 'image'"
          :src="imageSource(block)"
          class="dt-image"
          :class="{ zoomed: zoomed === index }"
          alt="消息图片"
          loading="lazy"
          role="button"
          tabindex="0"
          :aria-pressed="zoomed === index"
          :title="zoomed === index ? '点击还原' : '点击放大'"
          @click="zoomed = zoomed === index ? null : index"
          @keydown.enter.prevent="zoomed = zoomed === index ? null : index"
          @keydown.space.prevent="zoomed = zoomed === index ? null : index"
        />
        <MarkdownRender
          v-else-if="block.type === 'text'"
          :content="readableText(block.text)"
          :is-dark="true"
          html-policy="escape"
          :final="final"
        />
        <Disclosure v-else-if="block.type === 'thinking'" title="思考过程" class="dt-thinking">
          <MarkdownRender
            :content="block.thinking"
            :is-dark="true"
            html-policy="escape"
            :final="final"
          />
        </Disclosure>
        <ToolCallView
          v-else-if="block.type === 'toolCall' && block.id && block.name"
          :client="client"
          :block="block"
          :call="toolCalls?.get(block.id)?.call"
          :result="toolCalls?.get(block.id)?.result"
          :renderer="toolRenderers?.[block.name]"
        />
        <MarkdownRender
          v-else
          :content="jsonMarkdown(block)"
          :is-dark="true"
          html-policy="escape"
          :final="final"
        />
      </template>
    </template>
    <MarkdownRender
      v-else
      :content="jsonMarkdown(value)"
      :is-dark="true"
      html-policy="escape"
      :final="final"
    />
  </div>
</template>
