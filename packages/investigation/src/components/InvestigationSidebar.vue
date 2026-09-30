<script setup lang="ts">
import { Button, Dialog, Popover } from '@vuetify/v0/components';
import { computed, shallowRef } from 'vue';

import type {
  InvestigationConversation,
  InvestigationRoom,
  InvestigationTargetInput,
} from '../types.ts';
import InvestigationSessionGroup from './InvestigationSessionGroup.vue';
import InvestigationTargetPicker from './InvestigationTargetPicker.vue';

const props = defineProps<{
  conversations: readonly InvestigationConversation[];
  selectedSessionId?: string;
  currentRoom?: InvestigationRoom;
  disabled?: boolean;
  busySessionIds?: ReadonlySet<string>;
}>();

const emit = defineEmits<{
  create: [target: InvestigationTargetInput];
  select: [sessionId: string];
  delete: [sessionId: string];
}>();

const createOpen = shallowRef(false);
const deleteOpen = shallowRef(false);
const deletionCandidate = shallowRef<InvestigationConversation>();

const groups = computed(() => {
  const global: InvestigationConversation[] = [];
  const rooms = new Map<number, InvestigationConversation[]>();

  for (const conversation of props.conversations.toReversed()) {
    if (conversation.target.type === 'global') {
      global.push(conversation);
      continue;
    }

    const roomId = conversation.target.roomId;
    const conversations = rooms.get(roomId) ?? [];
    conversations.push(conversation);
    rooms.set(roomId, conversations);
  }

  const result = global.length ? [{ id: 'global', label: '全局', conversations: global }] : [];

  for (const [roomId, conversations] of rooms) {
    const room = conversations.find(item => item.room)?.room;
    const label = room ? `${room.streamerName} · ${roomId}` : `房间 ${roomId}`;
    result.push({ id: `room:${roomId}`, label, conversations });
  }

  return result;
});

function create(target: InvestigationTargetInput) {
  createOpen.value = false;
  emit('create', target);
}

function requestDelete(conversation: InvestigationConversation) {
  deletionCandidate.value = conversation;
  deleteOpen.value = true;
}

function confirmDelete() {
  const sessionId = deletionCandidate.value?.sessionId;

  if (!sessionId) {
    return;
  }

  deleteOpen.value = false;
  deletionCandidate.value = undefined;
  emit('delete', sessionId);
}
</script>

<template>
  <aside id="investigation-sidebar" class="investigation-sidebar" aria-label="调查会话">
    <div class="investigation-session-list">
      <p v-if="!conversations.length" class="investigation-session-empty">还没有调查记录</p>
      <InvestigationSessionGroup
        v-for="group in groups"
        :key="group.id"
        :label="group.label"
        :conversations="group.conversations"
        :selected-session-id="selectedSessionId"
        :disabled="disabled"
        :busy-session-ids="busySessionIds"
        @select="emit('select', $event)"
        @delete="requestDelete"
      />
    </div>

    <div class="investigation-create-row">
      <Popover.Root
        v-model="createOpen"
        position-area="top span-right"
        position-try="most-width top"
      >
        <Popover.Activator
          class="investigation-icon-button"
          :disabled="disabled"
          aria-label="新建调查"
          title="新建调查"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </Popover.Activator>
        <Popover.Content class="investigation-create-popover">
          <InvestigationTargetPicker
            :current-room="currentRoom"
            :disabled="disabled"
            @create="create"
          />
        </Popover.Content>
      </Popover.Root>
    </div>

    <Dialog.Root v-model="deleteOpen">
      <Dialog.Content class="investigation-delete-dialog">
        <Dialog.Title class="investigation-delete-title">删除调查</Dialog.Title>
        <Dialog.Description class="investigation-delete-description">
          确定删除“{{ deletionCandidate?.title }}”吗？删除后将无法在调查列表中恢复。
        </Dialog.Description>
        <div class="investigation-delete-actions">
          <Dialog.Close class="investigation-dialog-button">取消</Dialog.Close>
          <Button.Root class="investigation-dialog-button danger" @click="confirmDelete">
            删除
          </Button.Root>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  </aside>
</template>
