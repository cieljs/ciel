<script setup lang="ts">
import {
  ArrowUp,
  ExternalLink,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Shrink,
  X,
} from '@lucide/vue';
import { Button } from '@vuetify/v0/components';
import { CielConsole, type MessageRenderers, type ToolRenderers } from 'cieljs/console';
import { computed, ref } from 'vue';

import type { StartWatchOptions } from '../../../shared/types.ts';

import 'cieljs/console/style.css';
import { useBliveAgent } from '../composables/use-blive-agent.ts';
import { useSidebar } from '../composables/use-sidebar.ts';
import { rpc, watchBridge } from '../rpc.ts';
import AccountControls from './AccountControls.vue';
import DevToolsMenu from './DevToolsMenu.vue';
import EventTimeline from './EventTimeline.vue';
import FollowRoomDialog from './FollowRoomDialog.vue';
import LiveRoomWebview from './LiveRoomWebview.vue';
import RoomDecisionMessage from './RoomDecisionMessage.vue';
import RuntimeSetup from './RuntimeSetup.vue';
import SendDanmakuToolCall from './SendDanmakuToolCall.vue';
import StreamerHistoryToolCall from './StreamerHistoryToolCall.vue';
import WatchControls from './WatchControls.vue';

const {
  events,
  state,
  activeSessionId,
  account,
  areas,
  configuration,
  hearingModels,
  error,
  pending,
  ready,
  requestedRoomId,
  videoProgress,
  subtitle,
  active,
  attached,
  start,
  stop,
  compactContext,
  openDevTools,
  login,
  logout,
  refreshAccount,
  installHearingModels,
  selectHearingModel,
} = useBliveAgent();

const { collapsed, width, maxWidth, dragging, startDrag, moveDrag, endDrag, keyboardResize } =
  useSidebar();

const right = useSidebar('right');

const sidebar = ref<HTMLElement>();
const sidebarScrolled = ref(false);

function updateSidebarScrolled() {
  sidebarScrolled.value = (sidebar.value?.scrollTop ?? 0) > 0;
}

function scrollSidebarToTop() {
  sidebar.value?.scrollTo({ top: 0, behavior: 'smooth' });
}

// Ciel Console 按工具名挑选渲染组件，避免把原始 JSON 直接摆给使用者；用普通常量，不要放进 reactive。
const toolRenderers: ToolRenderers = {
  send_danmaku: SendDanmakuToolCall,
  get_streamer_dynamics: StreamerHistoryToolCall,
  get_streamer_videos: StreamerHistoryToolCall,
};

/** 决策协议见 main/agent/decisions.ts 的 RoomDecisionSchema；其余 assistant 内容仍走默认渲染。 */
const isRoomDecision = (json: unknown): boolean =>
  typeof json === 'object' && json !== null && 'action' in json && 'score' in json;

const messageRenderers: MessageRenderers = [
  {
    match: message => message.name === 'assistant' && isRoomDecision(message.json),
    component: RoomDecisionMessage,
  },
];

const roomTitle = computed(() => {
  const room = state.value.room;

  if (!room) {
    return '一起看看，今天有什么有趣的直播';
  }

  return `${room.streamerName} · ${room.title}`;
});

async function startRequestedRoom(options: StartWatchOptions) {
  await start(options);

  if (!error.value) {
    requestedRoomId.value = undefined;
  }
}

/** 顶栏按钮：开一个独立的 B 站浏览窗口，不占用正在观看的直播 webview。 */
function openBrowse() {
  void watchBridge.openBrowseWindow();
}

function openInvestigation() {
  void watchBridge.openInvestigationWindow();
}

const videoProgressLabel = computed(() => {
  if (videoProgress.value?.stage === 'analyzing' && state.value.status === 'stopping') {
    return '正在总结已读取的视频内容…';
  }

  if (videoProgress.value?.stage === 'recognizing') {
    return '正在完成语音识别…';
  }

  if (videoProgress.value?.stage === 'analyzing') {
    return '预处理完成，正在分析视频…';
  }

  return '正在提取音频与画面…';
});
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden">
    <header
      class="app-header flex h-9 shrink-0 basis-9 items-center gap-3 pr-[148px] pl-2.5 select-none"
    >
      <Button.Root
        class="action icon-button"
        :aria-expanded="!collapsed"
        aria-controls="watch-sidebar"
        :aria-label="collapsed ? '展开侧边栏' : '收起侧边栏'"
        :title="collapsed ? '展开侧边栏' : '收起侧边栏'"
        @click="collapsed = !collapsed"
      >
        <PanelLeftOpen v-if="collapsed" :size="16" />
        <PanelLeftClose v-else :size="16" />
      </Button.Root>
      <strong class="text-accent text-[13px] font-[650] whitespace-nowrap"
        >Ciel <span class="text-muted text-[11px] font-normal">· Blive Agent</span></strong
      >
      <span class="text-muted truncate text-[11px]">{{ roomTitle }}</span>
      <span
        class="text-muted ml-auto flex shrink-0 items-center gap-2 text-[11px] uppercase"
        role="status"
      >
        <span
          class="relative flex size-1.5"
          :class="state.status === 'watching' ? 'text-emerald-400' : 'text-muted'"
          aria-hidden="true"
        >
          <span
            v-if="state.status === 'watching'"
            class="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-75 motion-reduce:animate-none"
          />
          <span class="relative inline-flex size-full rounded-full bg-current" />
        </span>
        {{ state.status }}
      </span>
      <Button.Root
        class="action icon-button"
        title="打开 Investigation"
        aria-label="打开 Investigation"
        @click="openInvestigation"
      >
        <Search :size="16" />
      </Button.Root>
      <Button.Root
        class="action icon-button"
        title="打开 B 站浏览窗口"
        aria-label="打开 B 站浏览窗口"
        @click="openBrowse"
      >
        <ExternalLink :size="16" />
      </Button.Root>
      <DevToolsMenu @select="openDevTools" />
      <Button.Root
        class="action icon-button"
        :aria-expanded="!right.collapsed.value"
        aria-controls="watch-console"
        aria-label="展开或收起 Ciel Console"
        title="展开或收起 Ciel Console"
        @click="right.collapsed.value = !right.collapsed.value"
      >
        <PanelRightOpen v-if="right.collapsed.value" :size="16" />
        <PanelRightClose v-else :size="16" />
      </Button.Root>
    </header>
    <main
      class="workspace grid min-h-0 flex-1 p-0"
      :class="{
        resizing: dragging || right.dragging.value,
        'grid-cols-[var(--sidebar-width)_3px_minmax(0,1fr)]': !collapsed,
        'grid-cols-[minmax(0,1fr)]': collapsed,
      }"
      :style="{ '--sidebar-width': `${width}px`, '--console-width': `${right.width.value}px` }"
    >
      <div v-show="!collapsed" class="relative flex min-h-0 max-w-[560px] min-w-[260px] flex-col">
        <aside
          id="watch-sidebar"
          ref="sidebar"
          class="flex min-h-0 flex-1 flex-col overflow-auto"
          @scroll.passive="updateSidebarScrolled"
        >
          <AccountControls
            :account="account"
            :pending="pending"
            :ready="ready"
            @login="login"
            @logout="logout"
            @refresh="refreshAccount"
          />
          <RuntimeSetup
            :configuration="configuration"
            :models="hearingModels"
            :pending="pending"
            @install-models="installHearingModels"
            @select-model="selectHearingModel"
          />
          <WatchControls
            :areas="areas"
            :active="active"
            :pending="pending"
            :ready="!!configuration?.valid && !!hearingModels?.valid"
            :live-page-ready="ready"
            @start="start"
            @stop="stop"
          />
          <EventTimeline :events="events" />
        </aside>
        <Button.Root
          v-if="sidebarScrolled"
          class="text-muted hover:text-foreground absolute bottom-3 left-1/2 z-20 grid size-7 -translate-x-1/2 cursor-pointer place-items-center rounded-full border border-[#ffffff1a] bg-[#27272a] shadow-[0_4px_12px_#00000059] transition-colors hover:bg-[#3f3f46]"
          aria-label="回到侧边栏顶部"
          title="回到侧边栏顶部"
          @click="scrollSidebarToTop"
        >
          <ArrowUp :size="14" />
        </Button.Root>
      </div>
      <div
        v-show="!collapsed"
        class="resize-handle relative z-10 my-2 rounded-lg"
        role="separator"
        tabindex="0"
        aria-label="调整侧边栏宽度"
        aria-orientation="vertical"
        aria-controls="watch-sidebar"
        :aria-valuenow="width"
        :aria-valuemin="260"
        :aria-valuemax="maxWidth"
        @pointerdown="startDrag"
        @pointermove="moveDrag"
        @pointerup="endDrag"
        @pointercancel="endDrag"
        @lostpointercapture="endDrag"
        @keydown="keyboardResize"
      />
      <!-- 侧栏分界线就是容器的左边框：容器左移 2px，线正好落在 3px 拖拽区正中，两侧各留 1px。 -->
      <div
        class="viewer-container bg-surface grid min-h-0 min-w-0 overflow-hidden rounded-tl-xl border border-r-0 border-b-0 border-[#ffffff16] [box-shadow:0_2px_12px_#00000018,inset_0_1px_0_#ffffff04]"
        :class="{
          '-ml-0.5': !collapsed,
          'grid-cols-[minmax(240px,1fr)_3px_var(--console-width)]': !right.collapsed.value,
          'grid-cols-[minmax(0,1fr)]': right.collapsed.value,
          'rounded-tr-xl': right.collapsed.value,
        }"
      >
        <section class="bg-surface flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div
            v-if="error"
            class="m-0 flex items-start gap-3 bg-[#442936] px-4 py-2.5 text-[12px] [overflow-wrap:anywhere] text-[#ffc1d2]"
            role="alert"
          >
            <span class="min-w-0 flex-1">{{ error }}</span>
            <Button.Root
              class="action icon-button"
              aria-label="关闭错误提示"
              title="关闭错误提示"
              @click="error = ''"
              ><X :size="14"
            /></Button.Root>
          </div>
          <div v-if="videoProgress" class="border-b border-[#ffffff16] px-4 py-3 text-[12px]">
            <div class="mb-2 flex justify-between gap-3">
              <span>{{ videoProgressLabel }}</span>
              <span v-if="videoProgress.processedSeconds !== undefined" class="text-muted">
                {{ Math.floor(videoProgress.processedSeconds) }} 秒
                <template v-if="videoProgress.totalSeconds">
                  / {{ Math.ceil(videoProgress.totalSeconds) }} 秒</template
                >
              </span>
            </div>
            <progress
              class="accent-accent h-1.5 w-full"
              :aria-label="videoProgressLabel"
              :max="videoProgress.totalSeconds || 1"
              :value="
                videoProgress.totalSeconds
                  ? Math.min(videoProgress.processedSeconds ?? 0, videoProgress.totalSeconds)
                  : undefined
              "
            />
          </div>
          <div class="relative min-h-0 flex-1">
            <LiveRoomWebview @ready="attached" @error="error = $event" />
            <div
              v-if="subtitle"
              class="pointer-events-none absolute inset-x-4 bottom-5 flex justify-center"
              aria-live="polite"
            >
              <p
                class="max-w-[90%] rounded-md bg-black/75 px-4 py-2 text-center text-base leading-relaxed text-white [text-shadow:0_1px_2px_#000]"
              >
                {{ subtitle }}
              </p>
            </div>
          </div>
        </section>
        <div
          v-show="!right.collapsed.value"
          class="resize-handle console-divider"
          role="separator"
          tabindex="0"
          aria-label="调整 Ciel Console 宽度"
          aria-orientation="vertical"
          aria-controls="watch-console"
          :aria-valuenow="right.width.value"
          :aria-valuemin="260"
          :aria-valuemax="right.maxWidth.value"
          @pointerdown="right.startDrag"
          @pointermove="right.moveDrag"
          @pointerup="right.endDrag"
          @pointercancel="right.endDrag"
          @lostpointercapture="right.endDrag"
          @keydown="right.keyboardResize"
        />
        <aside
          v-show="!right.collapsed.value"
          id="watch-console"
          class="min-h-0 min-w-0 overflow-hidden"
        >
          <CielConsole
            :client="rpc.trace"
            :session-id="activeSessionId"
            :auto-scroll="active"
            :tool-renderers="toolRenderers"
            :message-renderers="messageRenderers"
          >
            <!-- 压缩入口跟着 Session 与控制台走：没有活动 Session 时压缩一定失败，就地禁用。 -->
            <template #actions>
              <Button.Root
                class="dt-button dt-action"
                title="压缩上下文"
                aria-label="压缩上下文"
                :disabled="!activeSessionId || pending === 'compact'"
                :aria-busy="pending === 'compact'"
                @click="compactContext"
              >
                <LoaderCircle v-if="pending === 'compact'" class="spinning" :size="15" />
                <Shrink v-else :size="15" />
              </Button.Root>
            </template>
          </CielConsole>
        </aside>
      </div>
    </main>
    <FollowRoomDialog
      v-model="requestedRoomId"
      :active="active"
      :pending="pending"
      :ready="ready && !!configuration?.valid && !!hearingModels?.valid"
      :error="error"
      @start="startRequestedRoom"
    />
  </div>
</template>
