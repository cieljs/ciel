<script setup lang="ts">
import { PanelLeftClose, PanelLeftOpen } from '@lucide/vue';
import { Button } from '@vuetify/v0/components';
import { InvestigationChat, type InvestigationClient } from 'cieljs/investigation';
import { onMounted, onUnmounted, shallowRef } from 'vue';

import type { RoomInfo } from '../../../shared/types.ts';
import { rpc, watchBridge } from '../rpc.ts';

import 'cieljs/console/style.css';
import 'cieljs/investigation/style.css';

const currentRoom = shallowRef<RoomInfo>();
const sidebarCollapsed = shallowRef(false);
let unsubscribe: (() => void) | undefined;

// oRPC 的路由节点是可调用 Proxy。包成普通对象后，既保留方法契约，也符合 Vue 的对象 prop 校验。
const investigationClient = {
  list: () => rpc.investigation.list(),
  create: input => rpc.investigation.create(input),
  rename: input => rpc.investigation.rename(input),
  delete: input => rpc.investigation.delete(input),
  updates: (input, options) => rpc.investigation.updates(input, options),
  prompt: input => rpc.investigation.prompt(input),
  abort: input => rpc.investigation.abort(input),
} satisfies InvestigationClient;

onMounted(async () => {
  const snapshot = await watchBridge.snapshot();
  currentRoom.value = snapshot.room;

  unsubscribe = watchBridge.onEvent(event => {
    if (event.type === 'room_opened') {
      currentRoom.value = event.room;
    } else if (event.type === 'status' && event.status === 'idle') {
      currentRoom.value = undefined;
    }
  });
});

onUnmounted(() => unsubscribe?.());
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden">
    <header class="app-header flex h-9 shrink-0 items-center gap-2 pr-[138px] pl-3 select-none">
      <Button.Root
        class="action icon-button"
        :aria-expanded="!sidebarCollapsed"
        aria-controls="investigation-sidebar"
        :aria-label="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
        :title="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
        @click="sidebarCollapsed = !sidebarCollapsed"
      >
        <PanelLeftOpen v-if="sidebarCollapsed" :size="18" />
        <PanelLeftClose v-else :size="18" />
      </Button.Root>
      <strong class="text-accent text-[14px] font-[650]">Ciel</strong>
      <span class="text-muted text-[12px]">· Investigation</span>
    </header>
    <main class="min-h-0 flex-1">
      <InvestigationChat
        v-model:sidebar-collapsed="sidebarCollapsed"
        :client="investigationClient"
        :trace-client="rpc.investigationTrace"
        :current-room="currentRoom"
      />
    </main>
  </div>
</template>
