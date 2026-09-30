<script setup lang="ts">
import { Button } from '@vuetify/v0/components';
import { shallowRef } from 'vue';

import type { InvestigationConversation } from '../types.ts';

defineProps<{
  label: string;
  conversations: readonly InvestigationConversation[];
  selectedSessionId?: string;
  disabled?: boolean;
  busySessionIds?: ReadonlySet<string>;
}>();

const emit = defineEmits<{
  select: [sessionId: string];
  delete: [conversation: InvestigationConversation];
}>();

const collapsed = shallowRef(false);

function sessionTime(createdAt: number) {
  return new Date(createdAt).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
</script>

<template>
  <section class="investigation-session-group">
    <Button.Root
      class="investigation-group-toggle"
      :aria-expanded="!collapsed"
      @click="collapsed = !collapsed"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M3 6.5h6l2 2h10v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <path d="M3 10h18" />
      </svg>
      <span>{{ label }}</span>
      <svg
        class="investigation-group-chevron"
        :class="{ collapsed }"
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
    </Button.Root>

    <div v-show="!collapsed" class="investigation-group-items">
      <div
        v-for="item in conversations"
        :key="item.sessionId"
        class="investigation-session-row"
        :class="{ active: item.sessionId === selectedSessionId }"
      >
        <Button.Root class="investigation-session" @click="emit('select', item.sessionId)">
          <span class="investigation-session-label">{{ item.title }}</span>
        </Button.Root>

        <span class="investigation-session-hover">
          <time :datetime="new Date(item.createdAt).toISOString()">
            {{ sessionTime(item.createdAt) }}
          </time>
          <Button.Root
            class="investigation-session-delete"
            :disabled="disabled || busySessionIds?.has(item.sessionId)"
            :aria-label="`删除 ${item.title}`"
            :title="`删除 ${item.title}`"
            @click.stop="emit('delete', item)"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" />
            </svg>
          </Button.Root>
        </span>
      </div>
    </div>
  </section>
</template>
