<script setup lang="ts">
import type { StartWatchOptions } from '@shared/types.ts';
import { Button, Dialog } from '@vuetify/v0/components';
import { computed, shallowRef, watch } from 'vue';

const props = defineProps<{
  active: boolean;
  pending: string;
  ready: boolean;
  error: string;
}>();

const roomId = defineModel<number>();

const emit = defineEmits<{
  start: [options: StartWatchOptions];
}>();

const live = shallowRef(false);

const open = computed({
  get: () => roomId.value !== undefined,
  set: value => {
    if (!value) {
      roomId.value = undefined;
    }
  },
});

const isPending = computed(() => Boolean(props.pending));
const isStarting = computed(() => props.pending === 'start');

const description = computed(() =>
  props.active
    ? `直播间 ${roomId.value}。开始后将结束当前观看，切换到这位主播。`
    : `直播间 ${roomId.value}。开始后将持续观看这位主播。`,
);

const deliveryHint = computed(() =>
  live.value ? '弹幕将真实发送到直播间，需要先登录。' : '默认模拟互动，不会向直播间发送弹幕。',
);

const startText = computed(() => (isStarting.value ? '正在启动…' : '开始单推'));

watch(roomId, () => {
  live.value = false;
});

function start() {
  if (!roomId.value || !props.ready || isPending.value) {
    return;
  }

  emit('start', {
    mode: {
      type: 'follow',
      roomId: roomId.value,
    },
    danmakuDelivery: live.value ? 'live' : 'simulate',
  });
}
</script>

<template>
  <Dialog.Root v-model="open">
    <Dialog.Content
      class="bg-surface text-foreground m-auto w-105 max-w-[calc(100vw-32px)] rounded-xl border border-[#ffffff16] p-5 shadow-xl backdrop:bg-black/60"
    >
      <Dialog.Title class="m-0 text-[16px] font-semibold"> 单推这个直播间 </Dialog.Title>

      <Dialog.Description class="text-muted my-3 text-[13px] leading-6">
        {{ description }}
      </Dialog.Description>

      <label class="check">
        <input v-model="live" type="checkbox" :disabled="isPending" />
        真实发送弹幕
      </label>

      <p class="hint">
        {{ deliveryHint }}
      </p>

      <p v-if="!ready" class="hint">请先完成模型配置并等待直播页面就绪。</p>

      <p v-if="error" class="text-accent text-[12px]" role="alert">
        {{ error }}
      </p>

      <div class="flex justify-end gap-2">
        <Dialog.Close class="action" aria-label="取消" :disabled="isPending"> 取消 </Dialog.Close>

        <Button.Root
          class="action bg-accent! text-[#362432]!"
          :disabled="!ready || isPending"
          :aria-busy="isStarting"
          @click="start"
        >
          {{ startText }}
        </Button.Root>
      </div>
    </Dialog.Content>
  </Dialog.Root>
</template>
