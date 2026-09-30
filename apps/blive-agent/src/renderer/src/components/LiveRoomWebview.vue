<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef } from 'vue';

import { watchBridge } from '../rpc.ts';

interface LiveGuest extends HTMLElement {
  getWebContentsId(): number;
}
const emit = defineEmits<{ ready: []; error: [message: string] }>();

const guest = useTemplateRef<LiveGuest>('guest');
let attachedId: number | undefined;

async function attach() {
  const id = guest.value!.getWebContentsId();

  // dom-ready 每次导航都会触发；同一个 guest 只交接一次，避免清空当前房间状态。
  if (id === attachedId) {
    return;
  }

  try {
    await watchBridge.attachLiveWebContents({ id });
    attachedId = id;
    emit('ready');
  } catch (error) {
    emit('error', error instanceof Error ? error.message : String(error));
  }
}

onMounted(() => guest.value!.addEventListener('dom-ready', attach));
onUnmounted(() => guest.value?.removeEventListener('dom-ready', attach));
</script>

<template>
  <webview
    ref="guest"
    class="flex h-full min-h-105 w-full"
    partition="persist:blive-agent"
    allowpopups
    src="https://live.bilibili.com/"
  />
</template>
