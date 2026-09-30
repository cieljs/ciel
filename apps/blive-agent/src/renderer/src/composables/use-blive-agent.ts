import type { WatchBridgeEvent, WatchSnapshot } from '@shared/ipc.ts';
import type {
  Account,
  DevToolsTarget,
  HearingModelStatus,
  LiveArea,
  StartWatchOptions,
  WatchConfigurationStatus,
  WatchEvent,
} from '@shared/types.ts';
import { useTimer } from '@vuetify/v0';
import type { ASRModelId } from 'cieljs/hearing';
import { computed, onMounted, onUnmounted, shallowRef } from 'vue';

import { watchBridge } from '../rpc.ts';
import { describeWatchEvent } from './watch-event.ts';

function describeError(message: string) {
  if (message.includes('content_filter')) {
    return '模型服务因内容过滤拒绝了本次请求（content_filter），本轮未完成。已暂停自动分析，请停止观看后检查输入内容或模型配置。';
  }

  return message;
}

export function useBliveAgent() {
  const events = shallowRef<{ id: number; time: string; text: string }[]>([]);
  let eventId = 0;
  const state = shallowRef<WatchSnapshot>({ status: 'idle' });
  const activeSessionId = shallowRef<string>();
  const account = shallowRef<Account>();
  const areas = shallowRef<readonly LiveArea[]>([]);
  const configuration = shallowRef<WatchConfigurationStatus>();
  const hearingModels = shallowRef<HearingModelStatus>();
  const error = shallowRef('');
  const pending = shallowRef('');
  const ready = shallowRef(false);
  const requestedRoomId = shallowRef<number>();
  const videoProgress = shallowRef<Extract<WatchEvent, { type: 'video_progress' }>>();
  const subtitle = shallowRef('');

  const subtitleTimer = useTimer(
    () => {
      subtitle.value = '';
    },
    { duration: 8_000 },
  );

  const active = computed(() => !['idle', 'closed'].includes(state.value.status));

  let disposed = false;

  const setupTimer = useTimer(
    () => {
      void refreshSetup();
    },
    { duration: 1_000 },
  );

  onUnmounted(() => {
    disposed = true;
  });

  // 串行轮询可恢复后台安装进度，同时发现用户在外部编辑的配置。
  async function refreshSetup() {
    try {
      const [config, models] = await Promise.all([
        watchBridge.configuration(),
        watchBridge.hearingModels(),
      ]);

      if (disposed) {
        return;
      }

      configuration.value = config;
      hearingModels.value = models;
    } catch (cause) {
      if (!disposed) {
        error.value = cause instanceof Error ? cause.message : String(cause);
      }
    } finally {
      if (!disposed) {
        setupTimer.start();
      }
    }
  }

  onMounted(() => {
    void refreshSetup();
  });

  function appendEvent(text: string) {
    events.value = [
      ...events.value,
      { id: ++eventId, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), text },
    ].slice(-60);
  }

  function receiveSubtitle(event: WatchBridgeEvent) {
    if (event.type === 'asr_subtitle') {
      subtitle.value = event.content;
      subtitleTimer.start();
    }

    if (
      event.type === 'room_closed' ||
      (event.type === 'status' && ['idle', 'closed'].includes(event.status))
    ) {
      subtitleTimer.stop();
      subtitle.value = '';
    }
  }

  function receive(event: WatchBridgeEvent) {
    receiveSubtitle(event);

    if (event.type === 'video_progress') {
      videoProgress.value = event;
    }

    if (event.type === 'status' && ['idle', 'closed'].includes(event.status)) {
      videoProgress.value = undefined;
    }

    if (event.type === 'room_requested') {
      requestedRoomId.value = event.roomId;
    }

    const text = describeWatchEvent(event);

    if (text) {
      appendEvent(text);
    }

    if (event.type === 'status') {
      state.value = { ...state.value, status: event.status };
    }

    if (event.type === 'room_opened') {
      state.value = { ...state.value, room: event.room };
      activeSessionId.value = event.sessionId;
    }

    if (event.type === 'room_closed') {
      state.value = { ...state.value, room: undefined };
      activeSessionId.value = undefined;
    }

    if (event.type === 'error') {
      error.value = describeError(event.message);
    }
  }

  const unsubscribe = watchBridge.onEvent(receive);
  onUnmounted(unsubscribe);

  async function run(name: string, action: () => Promise<unknown>) {
    if (pending.value && name !== 'stop') {
      return;
    }

    pending.value = name;
    error.value = '';

    try {
      await action();
    } catch (cause) {
      error.value = describeError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (pending.value === name) {
        pending.value = '';
      }
    }
  }

  async function refreshAccount() {
    account.value = await watchBridge.account();
  }

  // 打开开发者工具是调试动作：不进 pending，否则会顺手禁用开始/停止这些按钮。
  async function openDevTools(target: DevToolsTarget) {
    try {
      await watchBridge.openDevTools({ target });
    } catch (cause) {
      error.value = describeError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function attached() {
    ready.value = true;
    await run('refresh', refreshAccount);
  }

  onMounted(() =>
    run('initialize', async () => {
      const [loadedConfiguration, loadedModels] = await Promise.all([
        watchBridge.configuration(),
        watchBridge.hearingModels(),
      ]);

      configuration.value = loadedConfiguration;
      hearingModels.value = loadedModels;
      areas.value = await watchBridge.areas();

      if (ready.value) {
        await refreshAccount();
      }
    }),
  );

  return {
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
    start: (options: StartWatchOptions) => run('start', () => watchBridge.start(options)),
    stop: () => run('stop', () => watchBridge.stop()),
    compactContext: () =>
      run('compact', async () => {
        const compacted = await watchBridge.compactContext();
        appendEvent(compacted ? '已手动压缩上下文' : '当前没有可压缩的历史');
      }),
    openDevTools,
    login: () =>
      run('login', async () => {
        account.value = await watchBridge.login();
      }),
    logout: () =>
      run('logout', async () => {
        await watchBridge.logout();
        account.value = undefined;
      }),
    refreshAccount: () => run('refresh', refreshAccount),
    installHearingModels: () =>
      run('install-models', async () => {
        hearingModels.value = await watchBridge.installHearingModels();
      }),
    selectHearingModel: (model: ASRModelId) =>
      run('switch-model', async () => {
        hearingModels.value = await watchBridge.selectHearingModel(model);
      }),
  };
}
