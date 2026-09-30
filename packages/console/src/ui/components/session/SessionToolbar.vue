<script setup lang="ts">
import type { TraceSession } from '@cieljs/trace/protocol';
import { Select, Tabs } from '@vuetify/v0/components';

import { traceSessionLabel } from '../../utils/session-label.ts';

const props = defineProps<{
  sessions: TraceSession[];
}>();

const sessionId = defineModel<string>('sessionId', { required: true });

function selectedSessionLabel(value: unknown) {
  const session = props.sessions.find(item => item.id === value);

  return session ? traceSessionLabel(session) : String(value ?? '');
}
</script>

<template>
  <div class="dt-toolbar">
    <Tabs.List aria-label="Ciel Console 视图" class="dt-tabs dt-view-tabs">
      <Tabs.Item value="conversation" class="dt-tab">对话</Tabs.Item>
      <Tabs.Item value="execution" class="dt-tab">轨迹</Tabs.Item>
    </Tabs.List>

    <div class="dt-session-select">
      <Select.Root v-model="sessionId" :disabled="!sessions.length">
        <Select.Activator class="dt-session-activator" label="切换 Session">
          <Select.Value v-slot="{ selectedValue }">
            <span class="dt-session-value" :title="String(selectedValue)">
              {{ selectedSessionLabel(selectedValue) }}
            </span>
          </Select.Value>
          <Select.Placeholder>暂无 Session</Select.Placeholder>
          <Select.Cue class="dt-session-cue">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </Select.Cue>
        </Select.Activator>
        <Select.Content class="dt-session-menu">
          <Select.Item
            v-for="session in sessions.toReversed()"
            :id="session.id"
            :key="session.id"
            :value="session.id"
            class="dt-session-option"
            :title="session.id"
          >
            <span>{{ traceSessionLabel(session) }}</span>
            <small v-if="session.id === sessions.at(-1)?.id">最新</small>
          </Select.Item>
        </Select.Content>
      </Select.Root>
    </div>

    <slot />
  </div>
</template>
