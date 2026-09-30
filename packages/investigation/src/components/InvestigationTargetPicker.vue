<script setup lang="ts">
import { Button } from '@vuetify/v0/components';
import { computed, shallowRef } from 'vue';

import type { InvestigationRoom, InvestigationTargetInput } from '../types.ts';

const props = defineProps<{
  currentRoom?: InvestigationRoom;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  create: [target: InvestigationTargetInput];
}>();

const roomId = shallowRef('');

const validRoomId = computed(() => {
  const value = Number(roomId.value);

  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
});

function createRoom() {
  if (!validRoomId.value) {
    return;
  }

  emit('create', { type: 'room', roomId: validRoomId.value });
}
</script>

<template>
  <div class="investigation-create-menu">
    <header>
      <strong>新建调查</strong>
      <span>选择 Agent 可以读取和修改的记忆范围</span>
    </header>

    <Button.Root
      class="investigation-target-option"
      :disabled="disabled"
      @click="emit('create', { type: 'global' })"
    >
      <span class="investigation-target-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      </span>
      <span>
        <strong>全局调查</strong>
        <small>比较不同直播间，管理全局记忆</small>
      </span>
    </Button.Root>

    <Button.Root
      v-if="currentRoom"
      class="investigation-target-option"
      :disabled="disabled"
      @click="emit('create', { type: 'room', roomId: currentRoom.roomId })"
    >
      <span class="investigation-target-icon" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
        >
          <rect x="4" y="6" width="16" height="12" rx="3" />
          <path d="m9 3 3 3 3-3" />
          <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <span>
        <strong>当前直播间</strong>
        <small>{{ currentRoom.streamerName }} · {{ currentRoom.roomId }}</small>
      </span>
    </Button.Root>

    <form class="investigation-room-create" @submit.prevent="createRoom">
      <label for="investigation-room-id">指定直播间</label>
      <div>
        <input
          id="investigation-room-id"
          v-model="roomId"
          inputmode="numeric"
          autocomplete="off"
          placeholder="Bilibili 房间号"
          :disabled="disabled"
        />
        <Button.Root
          class="investigation-room-submit"
          :disabled="disabled || !validRoomId"
          aria-label="创建直播间调查"
          title="创建直播间调查"
          @click="createRoom"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Button.Root>
      </div>
    </form>
  </div>
</template>
