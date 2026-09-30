import { join } from 'node:path';

import { createBiliAgentTools } from '@cieljs/bili-agent-tools';
import { os } from '@orpc/server';
import { openCielData } from 'cieljs';
import { createMcp } from 'cieljs/mcp';
import { createTraceRouter, TraceHost, traceStorage, type TraceRouter } from 'cieljs/trace/host';
import { vectorStorage } from 'cieljs/vector';
import { session, type BrowserWindow } from 'electron';
import * as z from 'zod';

import type { WatchBridgeEvent } from '../shared/ipc.ts';
import { BilibiliApi } from './bilibili/api.ts';
import { LivePage } from './bilibili/live-page.ts';
import { resolveWatchConfig, resolveWatchModel, watchDataDirectory } from './config.ts';
import { readHearingModel, saveHearingModel } from './hearing-settings.ts';
import { createInvestigationRoutes } from './routes/investigation.ts';
import { createRecordingRoutes } from './routes/recording.ts';
import { createSetupRoutes } from './routes/setup.ts';
import { createWindowRoutes } from './routes/window.ts';
import { createBliveAgent, type BliveAgent } from './runtime.ts';

const positiveIntegerSchema = z.number().int().positive();
const requiredTextSchema = z.string().trim().min(1);
const recordingDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

const recordingSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('url'), url: z.url() }),
  z.object({ type: z.literal('file'), path: requiredTextSchema }),
]);

const watchModeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('follow'), roomId: positiveIntegerSchema }),
  z.object({ type: z.literal('explore'), areaId: positiveIntegerSchema }),
  z.object({
    type: z.literal('recording'),
    prompt: z.string().trim().optional(),
    roomId: positiveIntegerSchema,
    source: recordingSourceSchema,
    date: recordingDateSchema.optional(),
  }),
]);

const startSchema = z.object({
  mode: watchModeSchema,
  danmakuDelivery: z.enum(['simulate', 'live']).optional(),
});

/** 固定观看场景的资源与路由共享同一生命周期，初始化失败按逆序回收。 */
export async function createWatchApplication(mainWindow: BrowserWindow) {
  await using resources = new AsyncDisposableStack();
  const dataDirectory = watchDataDirectory();

  const data = resources.use(
    await openCielData({
      dataDir: join(dataDirectory, 'storage'),
      timeZone: 'Asia/Shanghai',
      modules: [vectorStorage, traceStorage],
    }),
  );

  const { storage } = data;

  // PGlite 没有后台 checkpointer：不推进 checkpoint 的话，进程被强杀后下次启动要重放
  // 上个 checkpoint 之后的全部 WAL，随会话数只增不减。
  let checkpointsStopped = false;

  const advanceCheckpoint = () => {
    if (checkpointsStopped) {
      return;
    }

    void storage.checkpoint().catch(error => console.error('推进存储 checkpoint 失败', error));
  };

  const checkpointInterval = setInterval(advanceCheckpoint, 5 * 60_000);
  const firstCheckpoint = setTimeout(advanceCheckpoint, 15_000);

  resources.defer(() => {
    checkpointsStopped = true;
    clearInterval(checkpointInterval);
    clearTimeout(firstCheckpoint);
  });

  // 历史重放留给后台：它随会话数增长，不能排在窗口显示前面。
  const trace = resources.use(await TraceHost.open({ storage, awaitReplay: false }));

  const mcp = resources.use(
    await createMcp({
      cwd: dataDirectory,
      configFile: join(dataDirectory, 'mcp.json'),
    }),
  );

  const livePage = new LivePage();
  resources.defer(() => livePage.close());
  const api = new BilibiliApi();
  const biliSession = session.fromPartition('persist:blive-agent');

  const biliTools = createBiliAgentTools({
    fetch: (url, init) => {
      const headers = new Headers(init?.headers);
      // Cookie 交给当前 Electron session，避免工具内部缓存覆盖网页登录态。
      headers.delete('Cookie');

      return biliSession.fetch(url, { ...init, headers });
    },
  });

  const listeners = new Set<(event: WatchBridgeEvent) => void>();
  let runtime: BliveAgent | undefined;
  let hearingModel = readHearingModel(dataDirectory);
  let unsubscribe: (() => void) | undefined;
  const lifetimeController = new AbortController();

  const investigation = createInvestigationRoutes({
    storage,
    data,
    sessions: data.investigations,
    mcp,
    biliTools,
    api,
    resolveModel: () => resolveWatchModel(resolveWatchConfig()),
    current: () => ({ room: runtime?.room, sessionId: runtime?.sessionId }),
  });

  resources.defer(() => investigation.close());

  function requireRuntime() {
    if (lifetimeController.signal.aborted) {
      throw new Error('Blive Agent 已关闭');
    }

    if (runtime) {
      return runtime;
    }

    const config = resolveWatchConfig();
    const ai = resolveWatchModel(config);

    runtime = createBliveAgent({
      mcp,
      biliTools,
      model: ai.model,
      apiKey: ai.apiKey,
      livePage,
      api,
      trace,
      storage,
      data,
      dataDir: dataDirectory,
      ffmpegPath: config.ffmpegPath,
      thinkingLevel: config.ai.thinkingLevel,
      wake: config.wake === false ? undefined : config.wake,
      perception: {
        asr: {
          model: hearingModel,
          bufferSeconds: 30,
          // 直播要跟得上现场：0.2 秒停顿收尾，单段最长 5 秒，都比包默认更短。
          vad: { minSilenceDuration: 0.2, maxSpeechDuration: 5 },
        },
      },
      ...config.interaction,
    });

    unsubscribe = runtime.onEvent(event => {
      trace.record(event.type, event);

      const value: WatchBridgeEvent =
        event.type === 'error'
          ? { type: 'error', stage: event.stage, message: event.error.message }
          : event;

      for (const listener of listeners) {
        listener(value);
      }
    });

    return runtime;
  }

  // 显式使用公开 TraceRouter，避免声明推断泄漏构建产物的私有类型。
  const isInvestigationSession = (sessionId: string) => sessionId.startsWith('investigation:');

  const traceRouter: TraceRouter = createTraceRouter(trace, {
    session: sessionId => !isInvestigationSession(sessionId),
  });

  const investigationTraceRouter: TraceRouter = createTraceRouter(trace, {
    session: isInvestigationSession,
  });

  const router = {
    trace: traceRouter,
    investigationTrace: investigationTraceRouter,
    investigation: investigation.router,
    account: {
      get: os.handler(() => livePage.account()),
      login: os.handler(async ({ signal }) => {
        await runtime?.stop();
        await livePage.login();

        return livePage.waitForLogin(signal);
      }),
      logout: os.handler(async () => {
        await runtime?.stop();
        await livePage.logout();
      }),
    },
    watch: {
      start: os.input(startSchema).handler(({ input }) => requireRuntime().start(input)),
      stop: os.handler(() => runtime?.stop()),
      compact: os.handler(() => {
        if (!runtime) {
          throw new Error('Blive Agent 尚未启动');
        }

        return runtime.compactContext();
      }),
      areas: os.handler(() => api.areas()),
      snapshot: os.handler(() => ({ status: runtime?.status ?? 'idle', room: runtime?.room })),
      // oxlint-disable-next-line eslint/complexity -- 流式路由需要在同一生成器内协调订阅、背压与中止清理。
      events: os.handler(async function* ({ signal }) {
        const queue: WatchBridgeEvent[] = [];
        let wake: (() => void) | undefined;

        const receive = (event: WatchBridgeEvent) => {
          queue.push(event);
          wake?.();
        };

        const abort = () => wake?.();
        // 先注册再发送快照，避免订阅建立期间漏掉房间事件。
        listeners.add(receive);
        signal?.addEventListener('abort', abort);
        lifetimeController.signal.addEventListener('abort', abort);

        try {
          yield { type: 'status', status: runtime?.status ?? 'idle' } satisfies WatchBridgeEvent;
          const room = runtime?.room;
          const sessionId = runtime?.sessionId;

          if (room && sessionId) {
            yield { type: 'room_opened', room, sessionId } satisfies WatchBridgeEvent;
          }

          while (!signal?.aborted && !lifetimeController.signal.aborted) {
            const pending = new Promise<void>(resolve => {
              wake = resolve;
            });

            if (queue.length) {
              yield queue.shift()!;
            } else {
              await pending;
            }
          }
        } finally {
          listeners.delete(receive);
          signal?.removeEventListener('abort', abort);
          lifetimeController.signal.removeEventListener('abort', abort);
        }
      }),
    },
    setup: createSetupRoutes(
      join(dataDirectory, 'models'),
      async model => {
        const previous = hearingModel;
        await runtime?.setHearingModel(model);

        try {
          saveHearingModel(dataDirectory, model);
        } catch (error) {
          await runtime?.setHearingModel(previous);
          throw error;
        }

        hearingModel = model;
      },
      hearingModel,
    ),
    recording: createRecordingRoutes(mainWindow),
    window: createWindowRoutes(mainWindow, livePage, roomId => {
      for (const listener of listeners) {
        listener({ type: 'room_requested', roomId });
      }
    }),
  };

  resources.defer(async () => {
    lifetimeController.abort();
    unsubscribe?.();
    listeners.clear();
    await runtime?.close();
  });

  const lifetime = resources.move();
  let closing: Promise<void> | undefined;

  return { router, close: () => (closing ??= lifetime.disposeAsync()) };
}

export type WatchRouter = Awaited<ReturnType<typeof createWatchApplication>>['router'];
