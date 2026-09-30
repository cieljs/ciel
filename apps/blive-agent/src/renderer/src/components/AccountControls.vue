<script setup lang="ts">
import { LoaderCircle, LogIn, LogOut, RefreshCw, UserRound } from '@lucide/vue';
import { Button } from '@vuetify/v0/components';

import type { Account } from '../../../shared/types.ts';

defineProps<{ account?: Account; pending: string; ready: boolean }>();
defineEmits<{ login: []; logout: []; refresh: [] }>();
</script>

<template>
  <!-- 这里不套外层容器：粘滞栏的包含块要是整个侧边栏滚动区，而不是某个 section 的盒子。 -->
  <div class="bg-surface sticky top-0 z-10 flex items-center gap-2.5 px-[18px] pt-4 pb-1">
    <img
      v-if="account?.face"
      :src="account.face"
      class="grid size-9 shrink-0 place-items-center rounded-[13px] bg-[#e4bded15] object-cover text-[#e4bded]"
      alt="账号头像"
      referrerpolicy="no-referrer"
    />
    <span
      v-else
      class="grid size-9 shrink-0 place-items-center rounded-[13px] bg-[#e4bded15] object-cover text-[#e4bded]"
      ><UserRound :size="20"
    /></span>
    <div class="flex min-w-0 flex-1 flex-col gap-[3px]">
      <strong class="truncate text-[12px]">{{ account?.name ?? '尚未登录' }}</strong
      ><small class="text-muted text-[10px]">{{
        account ? `UID ${account.uid}` : '和 Ciel 一起看直播'
      }}</small>
    </div>
    <Button.Root
      v-if="account"
      class="action icon-button"
      aria-label="退出登录"
      title="退出登录"
      :disabled="!!pending"
      :aria-busy="pending === 'logout'"
      @click="$emit('logout')"
    >
      <LoaderCircle v-if="pending === 'logout'" class="spinning" :size="14" />
      <LogOut v-else :size="14" />
    </Button.Root>
    <Button.Root
      v-if="!account"
      class="action icon-button"
      aria-label="登录 Bilibili"
      title="登录 Bilibili"
      :disabled="!ready || !!pending"
      :aria-busy="pending === 'login'"
      @click="$emit('login')"
    >
      <LoaderCircle v-if="pending === 'login'" class="spinning" :size="14" />
      <LogIn v-else :size="14" />
    </Button.Root>
    <Button.Root
      class="action icon-button"
      :disabled="!ready || !!pending"
      aria-label="刷新登录状态"
      title="刷新登录状态"
      @click="$emit('refresh')"
    >
      <RefreshCw :size="15" :class="{ spinning: pending === 'refresh' }" />
    </Button.Root>
  </div>
  <p v-if="!account" class="hint px-[18px]">在直播页面完成登录后，点刷新图标同步账号。</p>
</template>
