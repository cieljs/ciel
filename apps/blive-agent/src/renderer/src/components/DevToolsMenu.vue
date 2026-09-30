<script setup lang="ts">
import { AppWindow, Bug, MonitorPlay } from '@lucide/vue';
import { Button, Popover } from '@vuetify/v0/components';
import { Teleport, ref } from 'vue';

import type { DevToolsTarget } from '../../../shared/types.ts';

const emit = defineEmits<{ select: [target: DevToolsTarget] }>();

const open = ref(false);

const targets = [
  { target: 'live', icon: MonitorPlay, label: '直播页面', hint: 'BiliBili Live' },
  { target: 'renderer', icon: AppWindow, label: '渲染进程', hint: '主窗口' },
] as const;

function select(target: DevToolsTarget) {
  open.value = false;
  emit('select', target);
}
</script>

<template>
  <!-- 浮层宽度自带下限与视口钳制，不依赖 anchor-size：按钮一旦挪位置，弹层也不会跟着变形。 -->
  <Popover.Root v-model="open" position-area="bottom" position-try="most-width bottom">
    <Popover.Activator
      class="action icon-button"
      aria-label="打开开发者工具"
      title="打开开发者工具"
    >
      <Bug :size="16" />
    </Popover.Activator>
    <!-- 顶栏整条是 `-webkit-app-region: drag`。拖拽区是窗口级矩形、且不看 top layer：浮层只要还挂在
         header 里就会被算进去，鼠标落上去直接变成拖窗口，菜单项收不到 click。所以浮层传送到 body，
         再叠一层 no-drag，DOM 与像素都退出拖拽区。 -->
    <Teleport to="body">
      <Popover.Content
        class="floating-layer bg-surface text-foreground z-30 max-h-[min(320px,calc(100vh-52px))] max-w-[min(280px,calc(100vw-16px))] min-w-50 overflow-auto rounded-[7px] border border-[#ffffff16] p-1 shadow-[0_10px_30px_#0008]"
      >
        <!-- 布局只能留在内层：popover 元素本身一旦带上 display（哪怕只是 Tailwind 的 flex），作者样式就会盖掉
             UA 的 `[popover]:not(:popover-open){display:none}`，浮层不点也一直显形，而且再也关不掉。 -->
        <div class="flex flex-col gap-0.5">
          <Button.Root
            v-for="item in targets"
            :key="item.target"
            class="text-foreground rounded-2 flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-2 py-1.5 text-left text-[12px] hover:bg-[#ffffff0e] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]"
            @click="select(item.target)"
          >
            <component :is="item.icon" :size="14" class="text-muted shrink-0" />
            <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
            <small class="text-muted shrink-0 text-[10px]">{{ item.hint }}</small>
          </Button.Root>
        </div>
      </Popover.Content>
    </Teleport>
  </Popover.Root>
</template>
