import { createRouterClient } from '@orpc/server';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  openData: vi.fn(),
  openTrace: vi.fn(),
  createMcp: vi.fn(),
  createRuntime: vi.fn(),
  checkpoint: vi.fn(),
  account: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  compact: vi.fn(),
  resolveConfig: vi.fn(),
  createBiliTools: vi.fn(),
  sessionFetch: vi.fn(),
  fromPartition: vi.fn(),
}));

vi.mock('@cieljs/bili-agent-tools', () => ({ createBiliAgentTools: mocks.createBiliTools }));
vi.mock('electron', () => ({ session: { fromPartition: mocks.fromPartition } }));
vi.mock('cieljs', () => ({ openCielData: mocks.openData }));

vi.mock('cieljs/trace/host', () => ({
  TraceHost: { open: mocks.openTrace },
  traceStorage: {},
  createTraceRouter: () => ({}),
}));

vi.mock('cieljs/mcp', () => ({ createMcp: mocks.createMcp }));
vi.mock('cieljs/vector', () => ({ vectorStorage: {} }));

vi.mock('./config.ts', () => ({
  watchDataDirectory: () => '/watch-test',
  resolveWatchConfig: mocks.resolveConfig,
  resolveWatchModel: () => ({ model: { id: 'model' } }),
}));

vi.mock('./hearing-settings.ts', () => ({
  readHearingModel: () => 'sensevoice-small',
  saveHearingModel: vi.fn(),
}));

vi.mock('./routes/setup.ts', () => ({ createSetupRoutes: () => ({}) }));
vi.mock('./routes/window.ts', () => ({ createWindowRoutes: () => ({}) }));
vi.mock('./routes/recording.ts', () => ({ createRecordingRoutes: () => ({}) }));

vi.mock('./bilibili/api.ts', () => ({
  BilibiliApi: class {
    areas = async () => [];
  },
}));

vi.mock('./bilibili/live-page.ts', () => ({
  LivePage: class {
    account = mocks.account;
    close() {
      mocks.order.push('page');
    }
  },
}));

vi.mock('./runtime.ts', () => ({ createBliveAgent: mocks.createRuntime }));

import { createWatchApplication } from './application.ts';

const window = {} as BrowserWindow;
let application: Awaited<ReturnType<typeof createWatchApplication>> | undefined;

function resource(name: string) {
  return {
    [Symbol.asyncDispose]: async () => {
      mocks.order.push(name);
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.order.length = 0;

  mocks.openData.mockResolvedValue({
    storage: { checkpoint: mocks.checkpoint },
    investigations: resource('sessions'),
    [Symbol.asyncDispose]: async () => {
      mocks.order.push('sessions', 'storage');
    },
  });

  mocks.openTrace.mockResolvedValue({ ...resource('trace'), record: vi.fn() });
  mocks.createMcp.mockResolvedValue(resource('mcp'));
  mocks.createBiliTools.mockReturnValue([{ name: 'search_bili' }]);
  mocks.fromPartition.mockReturnValue({ fetch: mocks.sessionFetch });
  mocks.resolveConfig.mockReturnValue({ ai: {}, wake: false });

  mocks.createRuntime.mockReturnValue({
    status: 'idle',
    start: mocks.start,
    stop: mocks.stop,
    compactContext: mocks.compact,
    onEvent: () => () => mocks.order.push('unsubscribe'),
    close: async () => {
      mocks.order.push('runtime');
    },
  });
});

afterEach(async () => {
  await application?.close();
  application = undefined;
  vi.useRealTimers();
});

it('账号和快照无需 AI 配置，首次观看只创建一次运行时，关闭统一回收', async () => {
  application = await createWatchApplication(window);
  const client = createRouterClient(application.router);
  await client.account.get();
  expect(await client.watch.snapshot()).toEqual({ status: 'idle', room: undefined });
  expect(mocks.resolveConfig).not.toHaveBeenCalled();

  await client.watch.start({ mode: { type: 'follow', roomId: 123 } });
  await client.watch.start({ mode: { type: 'follow', roomId: 456 } });
  expect(mocks.createRuntime).toHaveBeenCalledOnce();
  expect(mocks.fromPartition).toHaveBeenCalledWith('persist:blive-agent');
  expect(mocks.createRuntime.mock.calls[0]![0].biliTools).toEqual([{ name: 'search_bili' }]);

  const biliFetch = mocks.createBiliTools.mock.calls[0]![0].fetch;

  await biliFetch('https://api.bilibili.com/x/web-interface/nav', {
    credentials: 'include',
    headers: { Cookie: 'stale=1', Referer: 'https://www.bilibili.com/' },
  });

  expect(mocks.sessionFetch).toHaveBeenCalledWith(
    'https://api.bilibili.com/x/web-interface/nav',
    expect.objectContaining({ credentials: 'include', headers: expect.any(Headers) }),
  );

  expect(mocks.sessionFetch.mock.calls[0]![1].headers.has('Cookie')).toBe(false);

  expect(mocks.createRuntime.mock.calls[0]![0].perception.asr).toEqual({
    model: 'sensevoice-small',
    bufferSeconds: 30,
    vad: { minSilenceDuration: 0.2, maxSpeechDuration: 5 },
  });

  const closing = application.close();
  expect(application.close()).toBe(closing);
  await closing;

  expect(mocks.order).toEqual([
    'unsubscribe',
    'runtime',
    'page',
    'mcp',
    'trace',
    'sessions',
    'storage',
  ]);

  expect(vi.getTimerCount()).toBe(0);

  await expect(client.watch.start({ mode: { type: 'follow', roomId: 123 } })).rejects.toThrow(
    '已关闭',
  );
});

it('手动压缩路由转发给运行时，尚未启动时拒绝', async () => {
  application = await createWatchApplication(window);
  const client = createRouterClient(application.router);
  mocks.compact.mockResolvedValue(true);

  await expect(client.watch.compact()).rejects.toThrow('尚未启动');

  await client.watch.start({ mode: { type: 'follow', roomId: 123 } });
  await expect(client.watch.compact()).resolves.toBe(true);
  expect(mocks.compact).toHaveBeenCalledOnce();
});

it('初始化中途失败时释放已打开资源和 checkpoint 定时器', async () => {
  mocks.createMcp.mockRejectedValue(new Error('MCP 配置无效'));
  await expect(createWatchApplication(window)).rejects.toThrow('MCP 配置无效');
  expect(mocks.order).toEqual(['trace', 'sessions', 'storage']);
  expect(vi.getTimerCount()).toBe(0);
});

it('关闭应用唤醒并结束等待中的事件订阅', async () => {
  application = await createWatchApplication(window);
  const stream = await createRouterClient(application.router).watch.events();
  expect((await stream.next()).value).toEqual({ type: 'status', status: 'idle' });
  const pending = stream.next();
  await application.close();
  expect((await pending).done).toBe(true);
});
