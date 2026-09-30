<script setup lang="ts">
import { Button } from '@vuetify/v0/components';
import { nextTick, shallowRef, useTemplateRef } from 'vue';

const props = defineProps<{
  disabled?: boolean;
  running?: boolean;
}>();

const emit = defineEmits<{
  submit: [content: string];
  abort: [];
}>();

const content = shallowRef('');
const textarea = useTemplateRef<HTMLTextAreaElement>('textarea');

function resize() {
  const element = textarea.value;

  if (!element) {
    return;
  }

  element.style.height = 'auto';
  element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  element.style.overflowY = element.scrollHeight > 160 ? 'auto' : 'hidden';
}

function submit() {
  const value = content.value.trim();

  if (!value || props.disabled || props.running) {
    return;
  }

  content.value = '';
  emit('submit', value);
  void nextTick(resize);
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
    return;
  }

  event.preventDefault();
  submit();
}
</script>

<template>
  <form class="investigation-composer" @submit.prevent="submit">
    <textarea
      ref="textarea"
      v-model="content"
      rows="1"
      placeholder="提出问题，或要求新增、修正、归档记忆…"
      :disabled="disabled"
      @input="resize"
      @keydown="handleKeydown"
    />
    <div class="investigation-composer-actions">
      <span>Enter 发送 · Shift+Enter 换行</span>
      <Button.Root
        v-if="running"
        class="investigation-send investigation-stop"
        :disabled="disabled"
        aria-label="停止生成"
        title="停止生成"
        @click="emit('abort')"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <rect x="2" y="2" width="8" height="8" rx="1" />
        </svg>
      </Button.Root>
      <Button.Root
        v-else
        class="investigation-send investigation-primary"
        type="submit"
        :disabled="disabled || !content.trim()"
        aria-label="发送"
        title="发送"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m5 12 7-7 7 7M12 19V5" />
        </svg>
      </Button.Root>
    </div>
  </form>
</template>
