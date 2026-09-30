import { Storage } from 'cieljs/storage';
import { afterAll } from 'vite-plus/test';
const storage = await Storage.open({ dataDir: 'memory://' });
afterAll(() => storage.close());
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import { registerFauxProvider } from '@earendil-works/pi-ai/compat';
import type { CielData, CielOptions, OpenSessionOptions } from 'cieljs';
import type { ASRResult, WakeEvent } from 'cieljs/hearing';
import { createPerception, type Perception, type PerceptionOptions } from 'cieljs/perception';
import type { TraceHost } from 'cieljs/trace/host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import type { Account } from '../shared/types.ts';
import type { BilibiliApi } from './bilibili/api.ts';
import type { LivePage } from './bilibili/live-page.ts';
import type { LiveMediaOptions } from './media/live-media.ts';
import { createPerceptionContext } from './prompts/index.ts';
import {
  createBliveAgent,
  type BliveAgent,
  type BliveAgentOptions,
  type WatchWakeOptions,
} from './runtime.ts';
import { loadVoiceprints } from './voiceprints.ts';

const mocks = vi.hoisted(() => ({
  constructCiel: vi.fn<(options: CielOptions) => void>(),
  start: vi.fn(),
  close: vi.fn(),
  session: vi.fn(),
  investigate: vi.fn(),
  mediaOptions: [] as LiveMediaOptions[],
  perceptionOptions: [] as PerceptionOptions[],
  mediaStart: vi.fn(),
  mediaClose: vi.fn(),
  createKWS: vi.fn(),
  kwsOn: vi.fn(),
  kwsClose: vi.fn(),
  kwsWrite: vi.fn(),
}));

vi.mock('cieljs/hearing', () => ({ createKWS: mocks.createKWS }));

vi.mock('cieljs', () => ({
  Ciel: class {
    constructor(options: CielOptions) {
      mocks.constructCiel(options);

      return mocks;
    }
  },
}));

vi.mock('cieljs/perception', () => ({ createPerception: vi.fn() }));
vi.mock('./config.ts', () => ({ watchDataDirectory: () => '/blive-agent-test' }));
vi.mock('./voiceprints.ts', () => ({ loadVoiceprints: vi.fn(() => []) }));
vi.mock('./bilibili/api.ts', () => ({ BilibiliApi: class {} }));
vi.mock('./bilibili/live-page.ts', () => ({ LivePage: class {} }));

vi.mock('./media/live-media.ts', () => ({
  LiveMedia: class {
    get endAt() {
      return new Date(Date.now() + 120_000);
    }
    constructor(options: LiveMediaOptions) {
      mocks.mediaOptions.push(options);
    }
    start = mocks.mediaStart;
    close = mocks.mediaClose;
  },
}));

const room = {
  roomId: 123,
  streamerUid: 456,
  streamerName: '主播',
  title: '聊天',
  description: '',
  parentAreaName: '娱乐',
  areaName: '聊天',
  live: true,
};

let runtime: BliveAgent;
let faux: ReturnType<typeof registerFauxProvider>;

function setup(
  trace?: TraceHost,
  wake?: WatchWakeOptions,
  perceptionOptions?: BliveAgentOptions['perception'],
  thinkingLevel?: ThinkingLevel,
) {
  faux = registerFauxProvider();
  const sessionClose = vi.fn().mockResolvedValue(undefined);
  const prompt = vi.fn().mockResolvedValue(undefined);
  const compact = vi.fn().mockResolvedValue(true);
  mocks.kwsOn.mockImplementation(() => vi.fn());

  mocks.createKWS.mockResolvedValue({
    on: mocks.kwsOn,
    close: mocks.kwsClose,
    write: mocks.kwsWrite,
  });

  mocks.session.mockImplementation(async (options: OpenSessionOptions) => ({
    id: options.sessionId,
    spaceId: options.spaceId,
    agent: { abort: vi.fn(), prompt, state: { messages: [] } },
    compact,
    close: sessionClose,
  }));

  const perceptionClose = vi.fn().mockResolvedValue(undefined);
  const setModel = vi.fn().mockResolvedValue(undefined);
  const asrOn = vi.fn(() => vi.fn());

  const perception = {
    asr: { on: asrOn, setModel },
    close: perceptionClose,
    on: vi.fn(() => vi.fn()),
    snapshot: vi.fn().mockResolvedValue({ compose: async () => [] }),
  } as unknown as Perception;

  const page = {
    liveStatus: vi.fn().mockResolvedValue('live'),
    account: vi.fn<() => Promise<Account | undefined>>().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    readiness: vi.fn().mockResolvedValue({ ready: true, roomId: room.roomId }),
    sendDanmaku: vi.fn().mockResolvedValue({ accepted: true }),
  };

  const api = {
    roomByStreamer: vi.fn().mockResolvedValue(room),
    playUrl: vi.fn().mockResolvedValue('https://example.com/live'),
    rooms: vi.fn().mockResolvedValue([room]),
    room: vi.fn().mockResolvedValue(room),
    streamerDynamics: vi.fn().mockResolvedValue([]),
    streamerVideos: vi.fn().mockResolvedValue([]),
  };

  vi.mocked(createPerception).mockImplementation(options => {
    mocks.perceptionOptions.push(options!);

    return perception;
  });

  runtime = createBliveAgent({
    dataDir: 'C:\\blive-agent',
    trace,
    storage,
    data: { storage } as CielData,
    model: faux.getModel(),
    livePage: page as unknown as LivePage,
    api: api as unknown as BilibiliApi,
    wake,
    perception: perceptionOptions,
    thinkingLevel,
  });

  return { page, api, sessionClose, perceptionClose, setModel, asrOn, prompt, compact };
}

describe('直播关键词唤醒', () => {
  function receiveWake(): (event: WakeEvent) => void {
    return mocks.kwsOn.mock.calls.find(([event]) => event === 'wake')![1];
  }

  it('唤醒不替 Ciel 应声，冷却内的重复命中合并成一轮并带上关键词', async () => {
    vi.useFakeTimers();
    const { page, prompt } = setup(undefined, { keywords: ['夏尔'] });
    const events: unknown[] = [];
    runtime.onEvent(event => events.push(event));
    await runtime.start({ mode: { type: 'follow', roomId: 123 } });
    receiveWake()({ keyword: '夏尔', at: new Date() });
    receiveWake()({ keyword: '夏尔', at: new Date() });
    expect(page.sendDanmaku).not.toHaveBeenCalled();

    expect(events.filter(event => (event as { type: string }).type.startsWith('danmaku'))).toEqual(
      [],
    );

    expect(prompt).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4000);
    expect(prompt).toHaveBeenCalledOnce();
    const content = prompt.mock.calls[0]![0].at(-1).content;
    expect(content).toContain('# 本轮关键词唤醒');
    expect(content).toContain('夏尔');
    expect(content).toContain('抢着发弹幕');
    expect(content).not.toContain('acknowledgment');
    expect(mocks.mediaOptions[0]?.kws?.write).toBe(mocks.kwsWrite);
  });

  it('真实模式的唤醒同样不发弹幕；冷却到期后才重新思考，模型自己的弹幕照常发出', async () => {
    vi.useFakeTimers();
    const { page, prompt } = setup(undefined, { keywords: ['夏尔'] });
    page.account.mockResolvedValue({ uid: 1, name: 'Ciel', face: '' });
    await runtime.start({ mode: { type: 'follow', roomId: 123 }, danmakuDelivery: 'live' });
    receiveWake()({ keyword: '夏尔', at: new Date() });
    await vi.advanceTimersByTimeAsync(4000);
    expect(page.sendDanmaku).not.toHaveBeenCalled();
    expect(prompt).toHaveBeenCalledOnce();

    const tool = mocks.constructCiel.mock.calls[0]![0].tools!.find(
      tool => tool.name === 'send_danmaku',
    )!;

    await tool.execute('reply', {
      action: 'send',
      content: '听到了，今天聊什么呀',
      reason: '回应呼唤',
    });

    expect(page.sendDanmaku).toHaveBeenCalledExactlyOnceWith('听到了，今天聊什么呀');
    // 15 秒冷却内的重复命中不重新思考，跨过冷却边界才排下一轮。
    receiveWake()({ keyword: '夏尔', at: new Date() });
    await vi.advanceTimersByTimeAsync(10_999);
    expect(prompt).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    receiveWake()({ keyword: '夏尔', at: new Date() });
    await vi.advanceTimersByTimeAsync(4000);
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(prompt.mock.calls[1]![0].at(-1).content).toContain('夏尔');
  });

  it('停止后忽略旧访问的唤醒回调，关闭检测器并取消等待', async () => {
    vi.useFakeTimers();
    const { prompt } = setup(undefined, { keywords: ['夏尔'] });
    await runtime.start({ mode: { type: 'follow', roomId: 123 } });
    const wake = receiveWake();
    wake({ keyword: '夏尔', at: new Date() });
    await runtime.stop();
    wake({ keyword: '夏尔', at: new Date() });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(prompt).not.toHaveBeenCalled();
    expect(mocks.kwsClose).toHaveBeenCalledOnce();
  });

  it('录播不创建关键词检测器', async () => {
    setup(undefined, { keywords: ['夏尔'] });

    await runtime.start({
      mode: { type: 'recording', roomId: 123, source: { type: 'file', path: '/video.mp4' } },
    });

    expect(mocks.createKWS).not.toHaveBeenCalled();
  });
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.mediaOptions.length = 0;
  mocks.perceptionOptions.length = 0;
});

afterEach(async () => {
  await runtime?.close();
  faux?.unregister();
  vi.useRealTimers();
});

describe('观看生命周期', () => {
  it('按配置设置会话的推理强度', async () => {
    setup(undefined, undefined, undefined, 'low');
    await runtime.start({ mode: { type: 'follow', roomId: 123 } });
    const session = await mocks.session.mock.results[0]!.value;

    expect(session.agent.state.thinkingLevel).toBe('low');
  });

  it('手动压缩上下文交给当前房间会话，未观看时拒绝', async () => {
    const { compact } = setup();
    await expect(runtime.compactContext()).rejects.toThrow('当前没有正在观看的直播间');

    await runtime.start({ mode: { type: 'follow', roomId: 123 } });
    await expect(runtime.compactContext()).resolves.toBe(true);
    expect(compact).toHaveBeenCalledOnce();
  });

  it('进房不预取主播动态与投稿，查询能力交由 Agent 按需使用', async () => {
    const { api } = setup();
    await runtime.start({ mode: { type: 'follow', roomId: 123 } });
    expect(api.streamerDynamics).not.toHaveBeenCalled();
    expect(api.streamerVideos).not.toHaveBeenCalled();

    expect(mocks.constructCiel.mock.calls[0]?.[0].tools?.map(tool => tool.name)).toEqual(
      expect.arrayContaining(['get_streamer_dynamics', 'get_streamer_videos']),
    );
  });

  it('视频对话保留无转写文本的声音事件', async () => {
    const recordMessage = vi.fn();
    const { asrOn } = setup({ observe: vi.fn(), recordMessage } as unknown as TraceHost);

    await runtime.start({
      mode: { type: 'recording', roomId: 123, source: { type: 'file', path: '/video.mp4' } },
    });

    const calls = asrOn.mock.calls as unknown as [string, (result: ASRResult) => void][];
    const receive = calls.find(([event]) => event === 'result')![1];

    receive({
      content: '',
      events: [{ type: 'applause' }],
      startAt: new Date(),
      endAt: new Date(),
    });

    expect(recordMessage).toHaveBeenCalledWith(
      expect.stringContaining('视频语音'),
      '声音事件（模型识别）：applause',
      expect.any(String),
    );
  });

  it('直播 ASR 结果作为字幕事件发送，空转写不显示', async () => {
    const { asrOn } = setup();
    const events: unknown[] = [];
    runtime.onEvent(event => events.push(event));
    await runtime.start({ mode: { type: 'follow', roomId: 123 } });

    const calls = asrOn.mock.calls as unknown as [string, (result: ASRResult) => void][];
    const receive = calls.find(([event]) => event === 'result')![1];
    receive({ content: '  大家晚上好  ', startAt: new Date(), endAt: new Date() });
    receive({ content: ' ', startAt: new Date(), endAt: new Date() });

    expect(events.filter(event => (event as { type: string }).type === 'asr_subtitle')).toEqual([
      { type: 'asr_subtitle', content: '大家晚上好' },
    ]);
  });

  it('观看时切换听觉模型沿用当前感知实例', async () => {
    const { setModel, perceptionClose } = setup();
    await runtime.start({ mode: { type: 'follow', roomId: 123 } });
    await runtime.setHearingModel('sensevoice-small');
    expect(setModel).toHaveBeenCalledWith('sensevoice-small');
    expect(perceptionClose).not.toHaveBeenCalled();
    expect(runtime.status).toBe('watching');
  });

  it('直播感知使用宿主的听觉转写提示词', async () => {
    setup();
    await runtime.start({ mode: { type: 'follow', roomId: 123 } });
    expect(mocks.perceptionOptions.at(-1)?.context).toBe(createPerceptionContext);
  });

  it.each(['follow', 'recording'] as const)(
    '%s 合并声纹和 ASR 配置，下一次观看重新扫描',
    async type => {
      setup(undefined, undefined, { asr: { model: 'sensevoice-small', bufferSeconds: 30 } });

      vi.mocked(loadVoiceprints).mockReturnValue([
        { name: '弥生', file: '/voices/弥生.voiceprint' },
      ]);

      const mode =
        type === 'follow'
          ? { type, roomId: 123 }
          : { type, roomId: 123, source: { type: 'file' as const, path: '/video.mp4' } };

      await runtime.start({ mode });

      expect(mocks.perceptionOptions.at(-1)?.asr).toEqual({
        model: 'sensevoice-small',
        bufferSeconds: 30,
        modelsPath: 'C:\\blive-agent\\models',
        speaker: [{ name: '弥生', file: '/voices/弥生.voiceprint' }],
      });

      await runtime.stop();

      vi.mocked(loadVoiceprints).mockReturnValue([
        { name: '夏尔', file: '/voices/夏尔.voiceprint' },
      ]);

      await runtime.start({ mode });

      expect(mocks.perceptionOptions.at(-1)?.asr?.speaker).toEqual([
        { name: '夏尔', file: '/voices/夏尔.voiceprint' },
      ]);

      expect(loadVoiceprints).toHaveBeenCalledTimes(2);
    },
  );

  it('录播感知使用宿主的听觉转写提示词', async () => {
    setup();

    await runtime.start({
      mode: { type: 'recording', roomId: 123, source: { type: 'file', path: '/video.mp4' } },
    });

    expect(mocks.perceptionOptions.at(-1)?.context).toBe(createPerceptionContext);
  });

  it('中途停止视频先等待识别、只生成一次部分总结，再关闭会话', async () => {
    const { perceptionClose, sessionClose } = setup();
    const recognition = Promise.withResolvers<void>();
    perceptionClose.mockReturnValue(recognition.promise);
    const prompt = vi.fn().mockResolvedValue(undefined);
    const abort = vi.fn();

    mocks.session.mockResolvedValue({
      id: 'video',
      agent: { abort, prompt, state: { messages: [] } },
      close: sessionClose,
    });

    await runtime.start({
      mode: { type: 'recording', roomId: 123, source: { type: 'file', path: '/video.mp4' } },
    });

    const stopping = runtime.stop();
    const repeated = runtime.stop();
    expect(repeated).toBe(stopping);
    expect(runtime.status).toBe('stopping');
    await vi.waitFor(() => expect(perceptionClose).toHaveBeenCalled());
    expect(mocks.mediaClose).toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
    expect(sessionClose).not.toHaveBeenCalled();
    recognition.resolve();
    await stopping;
    expect(abort).not.toHaveBeenCalled();
    expect(prompt).toHaveBeenCalledOnce();
    expect(prompt.mock.calls[0]![0].at(-1).content).toContain('部分总结');
    expect(prompt.mock.calls[0]![0].at(-1).content).toContain('不推测后续内容');
    expect(sessionClose).toHaveBeenCalledOnce();
    expect(runtime.status).toBe('idle');
  });

  it('关闭应用取消视频处理，不触发部分总结', async () => {
    setup();
    const prompt = vi.fn();

    mocks.session.mockResolvedValue({
      id: 'video',
      agent: { abort: vi.fn(), prompt, state: { messages: [] } },
      close: vi.fn(),
    });

    await runtime.start({
      mode: { type: 'recording', roomId: 123, source: { type: 'file', path: '/video.mp4' } },
    });

    await runtime.close();
    expect(prompt).not.toHaveBeenCalled();
    expect(runtime.status).toBe('closed');
  });

  it('视频先完成感知预处理，结束后只提交一次完整输入', async () => {
    vi.useFakeTimers();
    const { perceptionClose } = setup();
    const prompt = vi.fn().mockResolvedValue(undefined);

    mocks.session.mockResolvedValue({
      id: 'video',
      agent: { abort: vi.fn(), prompt, state: { messages: [] } },
      close: vi.fn(),
    });

    const events: unknown[] = [];
    runtime.onEvent(event => events.push(event));

    await runtime.start({
      mode: { type: 'recording', roomId: 123, source: { type: 'file', path: '/video.mp4' } },
    });

    await vi.advanceTimersByTimeAsync(90_000);
    expect(prompt).not.toHaveBeenCalled();
    mocks.mediaOptions[0]!.onStopped?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(prompt).toHaveBeenCalledOnce();

    expect(perceptionClose.mock.invocationCallOrder[0]).toBeLessThan(
      prompt.mock.invocationCallOrder[0]!,
    );

    expect(events).toContainEqual({ type: 'video_progress', stage: 'recognizing' });
    expect(events).toContainEqual({ type: 'video_progress', stage: 'analyzing' });
    expect(runtime.status).toBe('idle');
  });

  it('停止期间返回的房间查询不能重新导航或打开 Session', async () => {
    const { api, page } = setup();
    const query = Promise.withResolvers<typeof room>();
    api.room.mockReturnValue(query.promise);
    const starting = runtime.start({ mode: { type: 'follow', roomId: 456 } });
    const rejected = expect(starting).rejects.toThrow();
    await vi.waitFor(() => expect(api.room).toHaveBeenCalled());
    const stopping = runtime.stop();
    query.resolve(room);

    await rejected;
    await stopping;
    expect(page.open).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
    expect(runtime.status).toBe('idle');
  });

  it('切换房间前关闭旧访问，使用房间 Space 和日期 Session', async () => {
    const { api, page, sessionClose, perceptionClose } = setup();
    const events: unknown[] = [];
    runtime.onEvent(event => events.push(event));
    await runtime.start({ mode: { type: 'follow', roomId: 456 } });
    api.room.mockResolvedValue({ ...room, roomId: 789 });
    page.readiness.mockResolvedValue({ ready: true, roomId: 789 });
    await runtime.start({ mode: { type: 'follow', roomId: 456 } });

    expect(mocks.session.mock.calls[0][0].spaceId).toBe('bilibili:room:123');

    expect(mocks.session.mock.calls[1][0]).toMatchObject({
      spaceId: 'bilibili:room:789',
      crossSpace: true,
    });

    expect(mocks.session.mock.calls[1][0].sessionId).toMatch(
      /^bilibili:room:789:\d{4}-\d{2}-\d{2}$/,
    );

    expect(sessionClose.mock.invocationCallOrder[0]).toBeLessThan(
      page.open.mock.invocationCallOrder[1],
    );

    expect(perceptionClose).toHaveBeenCalledTimes(1);
    // 渲染进程靠 room_opened 携带的 Session 身份跟随切换后的房间。
    const opened = events.filter(event => (event as { type: string }).type === 'room_opened');

    expect(opened.at(-1)).toEqual({
      type: 'room_opened',
      room: expect.objectContaining({ roomId: 789 }),
      sessionId: mocks.session.mock.calls[1][0].sessionId,
    });
  });

  it('流地址失败会释放已经打开的 Session 与感知', async () => {
    const { api, sessionClose, perceptionClose } = setup();
    api.playUrl.mockRejectedValue(new Error('播放地址失败'));

    await expect(runtime.start({ mode: { type: 'follow', roomId: 456 } })).rejects.toThrow(
      '播放地址失败',
    );

    expect(sessionClose).toHaveBeenCalledTimes(1);
    expect(perceptionClose).toHaveBeenCalledTimes(1);
    expect(runtime.room).toBeUndefined();
    expect(runtime.status).toBe('idle');
  });

  it('探索显式允许跨空间读取，停止后不使用迟到的选择', async () => {
    const { page } = setup();
    const investigation = Promise.withResolvers<unknown>();
    mocks.investigate.mockReturnValue(investigation.promise);
    const starting = runtime.start({ mode: { type: 'explore', areaId: 1 } });
    const rejected = starting.catch(error => error);
    await vi.waitFor(() => expect(mocks.investigate).toHaveBeenCalled());

    expect(mocks.investigate.mock.calls[0][0]).toMatchObject({
      target: { type: 'global' },
      crossSpace: true,
    });

    const stopping = runtime.stop();
    expect(mocks.investigate.mock.calls[0][0].signal.aborted).toBe(true);

    investigation.resolve({
      answer: {
        role: 'assistant',
        content: [{ type: 'text', text: '{"roomId":123,"reason":"聊天"}' }],
      },
    });

    expect(await rejected).toBeInstanceOf(Error);
    await stopping;
    expect(page.open).not.toHaveBeenCalled();
  });

  it('录播复用房间 Space，但使用独立日期 Session 且不打开直播页面', async () => {
    const { page } = setup();

    await runtime.start({
      mode: {
        type: 'recording',
        roomId: 123,
        source: { type: 'file', path: 'C:\\Videos\\recording.mp4' },
        date: '2026-09-07',
      },
    });

    expect(page.open).not.toHaveBeenCalled();

    expect(mocks.session).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: 'bilibili:room:123',
        sessionId: 'bilibili:room:123:recording:2026-09-07',
      }),
    );

    expect(mocks.mediaOptions[0]).toMatchObject({
      input: 'C:\\Videos\\recording.mp4',
      live: false,
      roomId: 123,
    });
  });

  it('录播自然结束后生成最终总结再关闭访问', async () => {
    const { sessionClose } = setup();

    await runtime.start({
      mode: {
        type: 'recording',
        roomId: 123,
        source: { type: 'url', url: 'https://example.com/recording.mp4' },
      },
    });

    const session = await mocks.session.mock.results[0]!.value;

    mocks.mediaOptions[0]!.onStopped?.();

    await vi.waitFor(() => expect(runtime.status).toBe('idle'));

    const summaryContent = expect.stringContaining('最终总结');
    const summaryMessage = expect.objectContaining({ content: summaryContent });

    expect(session.agent.prompt).toHaveBeenCalledWith(expect.arrayContaining([summaryMessage]));

    expect(session.agent.prompt.mock.invocationCallOrder[0]).toBeLessThan(
      sessionClose.mock.invocationCallOrder[0],
    );
  });

  it('录播异常退出只报告错误并释放资源，不生成最终总结', async () => {
    const { sessionClose, perceptionClose } = setup();
    const events: unknown[] = [];
    runtime.onEvent(event => events.push(event));

    await runtime.start({
      mode: {
        type: 'recording',
        roomId: 123,
        source: { type: 'url', url: 'https://example.com/recording.mp4' },
      },
    });

    const session = await mocks.session.mock.results[0]!.value;
    const error = new Error('FFmpeg 解码失败');

    mocks.mediaOptions[0]!.onStopped?.(error);

    await vi.waitFor(() => expect(runtime.status).toBe('idle'));
    expect(events).toContainEqual({ type: 'error', stage: 'media', error });
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'recording_finished' }));
    expect(session.agent.prompt).not.toHaveBeenCalled();
    expect(sessionClose).toHaveBeenCalledOnce();
    expect(perceptionClose).toHaveBeenCalledOnce();
    expect(mocks.mediaClose).toHaveBeenCalledOnce();
    expect(runtime.room).toBeUndefined();
  });

  it('连续低分会真正重新探索和开房，不在思考结束回调中死锁', async () => {
    vi.useFakeTimers();
    const { api, page, sessionClose } = setup();
    const secondRoom = { ...room, roomId: 789 };
    api.rooms.mockResolvedValueOnce([room]).mockResolvedValue([secondRoom]);
    api.room.mockImplementation(async (id: number) => (id === 123 ? room : secondRoom));

    page.readiness.mockImplementation(async () => ({
      ready: true,
      roomId: page.open.mock.lastCall![0],
    }));

    const answer = (id: number) => ({
      answer: {
        role: 'assistant',
        content: [{ type: 'text', text: JSON.stringify({ roomId: id, reason: '看看新内容' }) }],
      },
    });

    mocks.investigate.mockResolvedValueOnce(answer(123)).mockResolvedValue(answer(789));

    mocks.session.mockImplementation(async (options: OpenSessionOptions) => ({
      id: options.sessionId,
      spaceId: options.spaceId,
      close: sessionClose,
      agent: {
        abort: vi.fn(),
        prompt: vi.fn().mockResolvedValue(undefined),
        state: {
          messages: [
            {
              role: 'assistant',
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    action: 'explore',
                    confidence: 0.9,
                    score: 10,
                    danmakuAction: 'defer',
                    evidence: ['长期没有新内容'],
                    reason: '探索其他房间',
                  }),
                },
              ],
            },
          ],
        },
      },
    }));

    await runtime.start({ mode: { type: 'explore', areaId: 1 } });
    await vi.advanceTimersByTimeAsync(90_001);
    expect(api.rooms).toHaveBeenCalledTimes(2);
    expect(runtime.room?.roomId).toBe(789);

    expect(sessionClose.mock.invocationCallOrder[0]).toBeLessThan(
      page.open.mock.invocationCallOrder[1],
    );

    expect(mocks.session.mock.calls[1][0].spaceId).toBe('bilibili:room:789');
  });

  it('切房时选房失败只报错，保留当前房间继续观看', async () => {
    vi.useFakeTimers();
    const { api, page, sessionClose } = setup();
    const secondRoom = { ...room, roomId: 789 };
    api.rooms.mockResolvedValueOnce([room]).mockResolvedValue([secondRoom]);
    api.room.mockImplementation(async (id: number) => (id === 123 ? room : secondRoom));

    page.readiness.mockImplementation(async () => ({
      ready: true,
      roomId: page.open.mock.lastCall![0],
    }));

    mocks.investigate.mockResolvedValueOnce({
      answer: {
        role: 'assistant',
        content: [{ type: 'text', text: JSON.stringify({ roomId: 123, reason: '看看新内容' }) }],
      },
    });

    // 第二轮选房给出不在候选里的房间，选房直接失败。
    mocks.investigate.mockResolvedValue({
      answer: {
        role: 'assistant',
        content: [{ type: 'text', text: JSON.stringify({ roomId: 999, reason: '换一个' }) }],
      },
    });

    mocks.session.mockImplementation(async (options: OpenSessionOptions) => ({
      id: options.sessionId,
      spaceId: options.spaceId,
      close: sessionClose,
      agent: {
        abort: vi.fn(),
        prompt: vi.fn().mockResolvedValue(undefined),
        state: {
          messages: [
            {
              role: 'assistant',
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    action: 'explore',
                    confidence: 0.9,
                    score: 10,
                    danmakuAction: 'defer',
                    evidence: ['长期没有新内容'],
                    reason: '探索其他房间',
                  }),
                },
              ],
            },
          ],
        },
      },
    }));

    const events: { type: string; stage?: string }[] = [];
    runtime.onEvent(event => events.push(event as { type: string; stage?: string }));

    await runtime.start({ mode: { type: 'explore', areaId: 1 } });
    await vi.advanceTimersByTimeAsync(90_001);

    expect(events).toContainEqual(expect.objectContaining({ type: 'error', stage: 'explore' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'exploration_started' }));
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'room_closed' }));
    expect(runtime.status).toBe('watching');
    expect(runtime.room?.roomId).toBe(123);
    expect(page.open).toHaveBeenCalledOnce();
    expect(sessionClose).not.toHaveBeenCalled();
  });

  it('切房后的候选剔除刚离开的房间，并把上一段观看带进选房问题', async () => {
    vi.useFakeTimers();
    const { api, page } = setup();
    const secondRoom = { ...room, roomId: 789, streamerName: '二号主播' };
    api.rooms.mockResolvedValueOnce([room]).mockResolvedValue([room, secondRoom]);
    api.room.mockImplementation(async (id: number) => (id === 123 ? room : secondRoom));

    page.readiness.mockImplementation(async () => ({
      ready: true,
      roomId: page.open.mock.lastCall![0],
    }));

    const answer = (id: number) => ({
      answer: {
        role: 'assistant',
        content: [{ type: 'text', text: JSON.stringify({ roomId: id, reason: '看看新内容' }) }],
      },
    });

    mocks.investigate.mockResolvedValueOnce(answer(123)).mockResolvedValue(answer(789));

    mocks.session.mockImplementation(async (options: OpenSessionOptions) => ({
      id: options.sessionId,
      spaceId: options.spaceId,
      close: vi.fn().mockResolvedValue(undefined),
      agent: {
        abort: vi.fn(),
        prompt: vi.fn().mockResolvedValue(undefined),
        state: {
          messages: [
            {
              role: 'assistant',
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    action: 'explore',
                    confidence: 0.9,
                    score: 10,
                    danmakuAction: 'defer',
                    evidence: ['长期没有新内容'],
                    reason: '探索其他房间',
                  }),
                },
              ],
            },
          ],
        },
      },
    }));

    await runtime.start({ mode: { type: 'explore', areaId: 1 } });
    await vi.advanceTimersByTimeAsync(90_001);

    expect(runtime.room?.roomId).toBe(789);
    const question = mocks.investigate.mock.calls[1][0].question as string;
    expect(question).toContain('# 上一段观看');
    expect(question).toContain('刚离开：主播（房间 123）· 聊天');
    expect(question).toContain('离开原因：宿主评分判定继续观看价值不足');
    // 只看候选清单：问句开头的输出示例里也有一个 roomId。
    const candidates = question.slice(question.indexOf('候选：\n'));
    expect(candidates).toContain('"roomId":789');
    expect(candidates).not.toContain('"roomId":123');
  });

  it('决策校验失败只报错，不停止观看', async () => {
    vi.useFakeTimers();
    const { api, page, sessionClose } = setup();
    api.rooms.mockResolvedValue([room]);

    mocks.investigate.mockResolvedValue({
      answer: {
        role: 'assistant',
        content: [{ type: 'text', text: JSON.stringify({ roomId: 123, reason: '看看新内容' }) }],
      },
    });

    mocks.session.mockImplementation(async (options: OpenSessionOptions) => ({
      id: options.sessionId,
      spaceId: options.spaceId,
      close: sessionClose,
      agent: {
        abort: vi.fn(),
        prompt: vi.fn().mockResolvedValue(undefined),
        // 纠正轮没有产生新的 assistant 消息，决策只能以校验失败结束。
        state: {
          messages: [{ role: 'assistant', content: [{ type: 'text', text: '没有 JSON' }] }],
        },
      },
    }));

    const events: unknown[] = [];
    runtime.onEvent(event => events.push(event));

    await runtime.start({ mode: { type: 'explore', areaId: 1 } });
    await vi.advanceTimersByTimeAsync(90_001);

    expect(runtime.status).toBe('watching');
    expect(page.open).toHaveBeenCalledOnce();
    expect(sessionClose).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({ type: 'error', stage: 'thought' }));
  });
});

it('跟随模式下播后释放媒体与会话并返回 idle', async () => {
  vi.useFakeTimers();
  const { page, api, sessionClose, perceptionClose } = setup();
  const events: unknown[] = [];
  runtime.onEvent(event => events.push(event));
  await runtime.start({ mode: { type: 'follow', roomId: 123 } });
  page.liveStatus.mockResolvedValue('offline');
  api.room.mockResolvedValue({ ...room, live: false });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(runtime.status).toBe('idle');
  expect(runtime.room).toBeUndefined();
  expect(sessionClose).toHaveBeenCalledOnce();
  expect(perceptionClose).toHaveBeenCalledOnce();
  expect(mocks.mediaClose).toHaveBeenCalledOnce();
  expect(events).toContainEqual({ type: 'room_closed', roomId: 123, reason: 'offline' });
});

it('媒体正常 EOF 但房间仍直播时停止访问并报告媒体错误', async () => {
  vi.useFakeTimers();
  setup();
  const events: unknown[] = [];
  runtime.onEvent(event => events.push(event));
  await runtime.start({ mode: { type: 'follow', roomId: 123 } });
  mocks.mediaOptions[0]!.onStopped?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.status).toBe('idle');
  expect(events).toContainEqual(expect.objectContaining({ type: 'error', stage: 'media' }));
});

it('旧房间的媒体退出通知不能关闭新房间', async () => {
  vi.useFakeTimers();
  const { api, page } = setup();
  await runtime.start({ mode: { type: 'follow', roomId: 123 } });
  const stopped = mocks.mediaOptions[0]!.onStopped;
  api.room.mockResolvedValue({ ...room, roomId: 789 });
  page.readiness.mockResolvedValue({ ready: true, roomId: 789 });
  await runtime.start({ mode: { type: 'follow', roomId: 789 } });
  stopped?.(new Error('迟到的退出通知'));
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.status).toBe('watching');
  expect(runtime.room?.roomId).toBe(789);
});

it('探索模式确认下播后释放旧房间并重新选房', async () => {
  vi.useFakeTimers();
  const { api, page, sessionClose } = setup();
  const secondRoom = { ...room, roomId: 789 };
  api.rooms.mockResolvedValueOnce([room]).mockResolvedValue([secondRoom]);

  api.room.mockResolvedValueOnce(room).mockImplementation(async (id: number) => {
    if (id === 123) {
      return { ...room, live: false };
    }

    return secondRoom;
  });

  page.readiness.mockImplementation(async () => ({
    ready: true,
    roomId: page.open.mock.lastCall![0],
  }));

  page.liveStatus.mockImplementation(async () =>
    page.open.mock.lastCall![0] === 123 ? 'offline' : 'live',
  );

  const answer = (id: number) => ({
    answer: {
      role: 'assistant',
      content: [{ type: 'text', text: JSON.stringify({ roomId: id, reason: '下一间' }) }],
    },
  });

  mocks.investigate.mockResolvedValueOnce(answer(123)).mockResolvedValue(answer(789));
  await runtime.start({ mode: { type: 'explore', areaId: 1 } });
  await vi.advanceTimersByTimeAsync(0);
  expect(api.rooms).toHaveBeenCalledTimes(2);
  expect(runtime.room?.roomId).toBe(789);
  expect(runtime.status).toBe('watching');
  expect(sessionClose).toHaveBeenCalledOnce();
});
