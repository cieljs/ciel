<script setup lang="ts">
import { FileVideo, LoaderCircle, Play, Square } from '@lucide/vue';
import type { LiveArea, StartWatchOptions, WatchMode } from '@shared/types.ts';
import { Button } from '@vuetify/v0/components';
import { computed, shallowRef } from 'vue';

import { watchBridge } from '../rpc';

const props = defineProps<{
  areas: readonly LiveArea[];
  active: boolean;
  pending: string;
  ready: boolean;
  livePageReady: boolean;
}>();

const emit = defineEmits<{
  start: [options: StartWatchOptions];
  stop: [];
}>();

const mode = shallowRef<WatchMode['type']>('follow');
const roomId = shallowRef<number>();
const areaId = shallowRef<number>();
const live = shallowRef(false);
const areaSearch = shallowRef('');
const recordingSource = shallowRef<'url' | 'file'>('url');
const recordingUrl = shallowRef('');
const recordingFile = shallowRef('');
const recordingDate = shallowRef('');
const recordingPrompt = shallowRef('');
const pickingFile = shallowRef(false);

const filteredAreas = computed(() => {
  const query = areaSearch.value.trim().toLocaleLowerCase();

  return props.areas
    .map(group => ({
      ...group,
      children: group.children.filter(area =>
        `${group.name} ${area.name} ${area.id}`.toLocaleLowerCase().includes(query),
      ),
    }))
    .filter(group => group.children.length > 0 || group.name.toLocaleLowerCase().includes(query));
});

// 模式和目标 ID 一起推导，校验与提交始终使用同一份选择。
const selectedMode = computed<WatchMode>(() => {
  if (mode.value === 'follow') {
    return { type: 'follow', roomId: roomId.value ?? 0 };
  }

  if (mode.value === 'recording') {
    const source =
      recordingSource.value === 'url'
        ? { type: 'url' as const, url: recordingUrl.value.trim() }
        : { type: 'file' as const, path: recordingFile.value };

    const date = recordingDate.value;

    return {
      type: 'recording',
      roomId: roomId.value ?? 0,
      source,
      ...(date ? { date } : {}),
      ...(recordingPrompt.value.trim() ? { prompt: recordingPrompt.value.trim() } : {}),
    };
  }

  return { type: 'explore', areaId: areaId.value ?? 0 };
});

const valid = computed(() => {
  const selected = selectedMode.value;
  const id = selected.type === 'explore' ? selected.areaId : selected.roomId;

  if (!Number.isSafeInteger(id) || id <= 0) {
    return false;
  }

  if (selected.type !== 'recording') {
    return true;
  }

  const hasSource =
    selected.source.type === 'url'
      ? /^https?:\/\//u.test(selected.source.url)
      : Boolean(selected.source.path);

  return hasSource;
});

async function pickRecordingFile() {
  pickingFile.value = true;

  try {
    const path = await watchBridge.pickRecordingFile();

    if (path) {
      recordingFile.value = path;
    }
  } finally {
    pickingFile.value = false;
  }
}

function start() {
  const mediaReady = mode.value === 'recording' || props.livePageReady;
  const canStart = valid.value && props.ready && mediaReady && !props.pending && !props.active;

  if (!canStart) {
    return;
  }

  emit('start', {
    mode: selectedMode.value,
    danmakuDelivery: mode.value !== 'recording' && live.value ? 'live' : 'simulate',
  });
}
</script>

<template>
  <section class="px-4.5 py-4">
    <div class="section-heading">观看设置</div>
    <form @submit.prevent="start">
      <fieldset :disabled="active || !!pending">
        <label
          >观看模式<select v-model="mode">
            <option value="follow">单推 · 只看这位主播</option>
            <option value="explore">DD 模式 · 发现感兴趣的直播</option>
            <option value="recording">视频模式 · 总结、分析和记忆</option>
          </select></label
        >
        <label v-if="mode !== 'explore'"
          >直播间 ID<input
            v-model.number="roomId"
            type="number"
            min="1"
            step="1"
            required
            placeholder="输入直播间号"
        /></label>
        <template v-if="mode === 'explore'">
          <label
            >搜索分区
            <input
              v-model="areaSearch"
              type="search"
              placeholder="分区名称或编号"
              @input="areaId = undefined"
            />
          </label>
          <label
            >直播分区
            <select v-model="areaId" required>
              <option :value="undefined" disabled>选择分区</option>
              <optgroup v-for="group in filteredAreas" :key="group.id" :label="group.name">
                <option :value="group.id">全部{{ group.name }}</option>
                <option v-for="area in group.children" :key="area.id" :value="area.id">
                  {{ area.name }}
                </option>
              </optgroup>
            </select>
          </label>
          <p v-if="filteredAreas.length === 0" class="hint">没有匹配的分区，试试其他关键词。</p>
        </template>
        <template v-if="mode === 'recording'">
          <label
            >视频来源<select v-model="recordingSource">
              <option value="url">在线视频 URL</option>
              <option value="file">本地视频</option>
            </select></label
          >
          <label v-if="recordingSource === 'url'"
            >视频 URL<input
              v-model="recordingUrl"
              type="url"
              required
              placeholder="https://example.com/video.mp4"
          /></label>
          <p v-if="recordingSource === 'url'" class="hint">
            请填写 FFmpeg 可直接读取的视频或流地址。
          </p>
          <div v-else class="mb-[13px]">
            <Button.Root
              class="action w-full"
              type="button"
              :disabled="pickingFile"
              @click="pickRecordingFile"
            >
              <LoaderCircle v-if="pickingFile" class="spinning" :size="16" />
              <FileVideo v-else :size="16" />
              {{ recordingFile ? '重新选择视频' : '选择本地视频' }}
            </Button.Root>
            <p
              v-if="recordingFile"
              class="text-muted mt-2 mb-0 text-[10px] leading-[1.5] break-all"
            >
              {{ recordingFile }}
            </p>
          </div>
          <label>视频日期（可选）<input v-model="recordingDate" type="date" /> </label>
          <label>
            场景与内容说明（可选）
            <textarea
              v-model="recordingPrompt"
              rows="4"
              placeholder="例如：这是一段游戏实况，主要在讨论新版本角色，请关注角色评价和有趣的互动。"
            />
          </label>
        </template>
        <label v-if="mode !== 'recording'" class="check"
          ><input v-model="live" type="checkbox" />真实发送弹幕</label
        >
        <p v-if="mode !== 'recording'" class="hint">
          {{
            live ? '弹幕将发送到当前直播间，需要先登录。' : '默认模拟互动，不会向直播间发送弹幕。'
          }}
        </p>
        <p v-else class="hint">视频模式不会发送或模拟弹幕，只进行总结、分析和记忆。</p>
      </fieldset>
      <Button.Root
        v-if="!active || pending === 'start'"
        class="action primary"
        @click="start"
        :disabled="!ready || (mode !== 'recording' && !livePageReady) || !!pending || !valid"
        :aria-busy="pending === 'start'"
      >
        <LoaderCircle v-if="pending === 'start'" class="spinning" :size="16" />
        <Play v-else :size="16" />
        {{ pending === 'start' ? '正在启动…' : '开始观看' }}
      </Button.Root>
      <Button.Root
        v-else
        class="action stop-action"
        type="button"
        :disabled="pending === 'stop'"
        :aria-busy="pending === 'stop'"
        @click="emit('stop')"
      >
        <LoaderCircle v-if="pending === 'stop'" class="spinning" :size="16" />
        <Square v-else :size="16" />
        <template v-if="mode === 'recording'">{{
          pending === 'stop' ? '正在整理总结…' : '停止并总结'
        }}</template>
        <template v-else>{{ pending === 'stop' ? '正在停止…' : '停止观看' }}</template>
      </Button.Root>
    </form>
  </section>
</template>
