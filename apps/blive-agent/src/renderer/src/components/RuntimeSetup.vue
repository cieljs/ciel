<script setup lang="ts">
import { Download, LoaderCircle } from '@lucide/vue';
import { Button, Progress } from '@vuetify/v0/components';
import type { ASRModelId } from 'cieljs/hearing';
import { computed } from 'vue';

import type { HearingModelStatus, WatchConfigurationStatus } from '../../../shared/types.ts';

const props = defineProps<{
  configuration?: WatchConfigurationStatus;
  models?: HearingModelStatus;
  pending: string;
}>();

const downloadLabel = computed(() => {
  if (props.models?.installing || props.pending === 'install-models') {
    return '正在下载模型…';
  }

  if (props.models?.error) {
    return '重试下载';
  }

  return '下载听觉模型';
});

const emit = defineEmits<{ installModels: []; selectModel: [model: ASRModelId] }>();

function selectModel(event: Event) {
  const value = (event.target as HTMLSelectElement).value;

  if (value === 'qwen3-asr-1.7b-int8' || value === 'sensevoice-small') {
    emit('selectModel', value);
  }
}
</script>

<template>
  <section class="border-b border-[#ffffff0b] px-4.5 pt-4 pb-3">
    <div class="section-heading">运行配置</div>
    <label class="my-3 flex flex-col gap-2 text-[11px]">
      听觉模型
      <select
        :value="models?.model"
        :disabled="!!pending || !!models?.installing"
        @change="selectModel"
      >
        <option v-for="model in models?.availableModels" :key="model" :value="model">
          {{ model }}
        </option>
      </select>
    </label>
    <p v-if="pending === 'switch-model'" class="hint" role="status">正在切换听觉模型…</p>
    <div
      v-if="!configuration?.valid"
      class="my-2 rounded-lg bg-[#442936] px-3 py-2 text-[11px] leading-[1.6] text-[#ffc1d2]"
    >
      <p class="m-0">{{ configuration?.message || '正在检查配置…' }}</p>
    </div>

    <template v-if="!models?.valid || models?.installing || models?.error">
      <p class="hint">
        {{ models ? `缺少 ${models.missingFiles.length} 个模型文件` : '正在检查听觉模型…' }}
      </p>
      <div v-if="models?.progress" class="my-3 rounded-lg bg-[#ffffff05] p-3 text-[11px]">
        <Progress.Root
          :model-value="models.progress.totalBytes ? models.progress.receivedBytes : undefined"
          :max="models.progress.totalBytes || 100"
          aria-label="当前模型下载进度"
        >
          <div class="mb-2 flex items-center justify-between gap-3">
            <Progress.Label class="min-w-0 truncate text-[#d6cbd3]">
              模型文件下载进度
            </Progress.Label>
            <Progress.Value
              v-if="models.progress.totalBytes"
              class="shrink-0 text-[#ffc1d2] tabular-nums"
            />
          </div>
          <Progress.Track class="h-1.5 w-full overflow-hidden rounded-full bg-[#ffffff0b]">
            <Progress.Fill
              class="h-full rounded-full bg-[#fb7299] transition-[width] duration-300 data-[state=indeterminate]:w-full data-[state=indeterminate]:animate-pulse motion-reduce:animate-none motion-reduce:transition-none"
            />
          </Progress.Track>
        </Progress.Root>
        <div class="mt-2 flex justify-between gap-2 text-[#9c929c] tabular-nums">
          <span>
            {{ (models.progress.receivedBytes / 1048576).toFixed(1) }} MB
            <template v-if="models.progress.totalBytes">
              / {{ (models.progress.totalBytes / 1048576).toFixed(1) }} MB</template
            >
          </span>
          <span v-if="(models.progress.attempt || 1) > 1"
            >第 {{ models.progress.attempt }} 次尝试</span
          >
        </div>
        <p v-if="models.progress.message" class="mb-0 break-all text-[#ffc1d2]" role="status">
          {{ models.progress.message }}{{ models.installing ? '，正在重试…' : '' }}
        </p>
      </div>
      <p v-if="models?.error" class="text-[11px] break-all text-[#ffc1d2]" role="alert">
        {{ models.error }}
      </p>
      <Button.Root
        class="action w-full justify-center bg-[#442936]! text-[#ffc1d2]!"
        type="button"
        :disabled="!!models?.installing || !!pending"
        :aria-busy="models?.installing || pending === 'install-models'"
        @click="emit('installModels')"
      >
        <LoaderCircle
          v-if="models?.installing || pending === 'install-models'"
          class="spinning"
          :size="16"
        />
        <Download v-else :size="16" />
        {{ downloadLabel }}
      </Button.Root>
    </template>
  </section>
</template>
