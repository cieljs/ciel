<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ events: readonly { id: number; time: string; text: string }[] }>();

// 倒叙展示：最新的事件落在最上面，不用每次滚到底部才能看到。
const newestFirst = computed(() => [...props.events].reverse());
</script>

<template>
  <section
    class="flex min-h-[100px] shrink-0 grow flex-col px-[18px] pt-3.5 pb-12 text-[11px]"
    aria-label="运行轨迹"
  >
    <div class="section-heading">运行轨迹</div>
    <p v-if="events.length === 0" class="hint">
      开始观看后，切房等操作记录与发送的弹幕会显示在这里。
    </p>
    <ol class="m-0 list-none p-0">
      <li
        v-for="event in newestFirst"
        :key="event.id"
        class="timeline-entry grid grid-cols-[52px_minmax(0,1fr)] gap-[7px] [overflow-wrap:anywhere]"
      >
        <time class="text-[#71717a]">{{ event.time }}</time
        ><span>{{ event.text }}</span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
/* 左侧一条竖直导轨配节点，把事件读成时间线。
   留白与行高放在这里而不是工具类：导轨要让开文字，节点要对上文字首行。 */
.timeline-entry {
  position: relative;
  padding: 4px 0 4px 16px;
  line-height: 17px;
}
.timeline-entry::before {
  content: '';
  position: absolute;
  top: 0;
  left: 3px;
  bottom: 0;
  width: 1px;
  background: #ffffff1a;
}
.timeline-entry::after {
  content: '';
  position: absolute;
  top: 9px;
  left: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #52525b;
  /* 用背景色描一圈，盖住导轨穿过节点的接缝。 */
  box-shadow: 0 0 0 3px var(--surface);
}
/* 倒序展示，首行就是最新事件：用强调色点出来。 */
.timeline-entry:first-child::after {
  background: var(--accent);
}
</style>
