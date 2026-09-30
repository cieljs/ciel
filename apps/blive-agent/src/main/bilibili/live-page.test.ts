import { runInNewContext } from 'node:vm';

import type { WebContents } from 'electron';
import { afterEach, expect, it, vi } from 'vite-plus/test';

afterEach(() => vi.useRealTimers());

import { LivePage } from './live-page.ts';

it.each([
  ['interactive', '/6154037', true],
  ['complete', '/6154037', true],
  ['loading', '/6154037', false],
  ['complete', '/', false],
])('页面状态 %s、路径 %s 的就绪判断不依赖播放器全局变量', async (readyState, pathname, ready) => {
  const page = new LivePage();

  page.attach({
    isDestroyed: () => false,
    getURL: () => `https://live.bilibili.com${pathname}`,
    once: () => undefined,
    executeJavaScript: (code: string) =>
      Promise.resolve(
        runInNewContext(code, {
          window: {},
          location: { hostname: 'live.bilibili.com', pathname },
          document: { readyState, body: {}, querySelector: () => null },
        }),
      ),
  } as unknown as WebContents);

  await expect(page.readiness()).resolves.toMatchObject({ ready });
});

it('短房号跳转仍识别真实房间 ID', async () => {
  const page = new LivePage();

  page.attach({
    isDestroyed: () => false,
    getURL: () => 'https://live.bilibili.com/52030',
    once: () => undefined,
    executeJavaScript: (code: string) =>
      Promise.resolve(
        runInNewContext(code, {
          location: { hostname: 'live.bilibili.com', pathname: '/52030' },
          window: {
            __NEPTUNE_IS_MY_WAIFU__: {
              roomInitRes: { data: { room_id: 21696950, short_id: 52030 } },
            },
          },
          document: { readyState: 'complete', body: {}, querySelector: () => null },
        }),
      ),
  } as unknown as WebContents);

  await expect(page.readiness()).resolves.toMatchObject({ ready: true, roomId: 21696950 });
});

it.each([
  [0, 'offline'],
  [1, 'live'],
  [2, 'offline'],
  [99, null],
  [undefined, null],
])('读取播放器 liveStatus=%s', async (status, expected) => {
  const page = new LivePage();

  page.attach({
    isDestroyed: () => false,
    getURL: () => 'https://live.bilibili.com/123',
    once: () => undefined,
    executeJavaScript: (code: string) =>
      Promise.resolve(
        runInNewContext(code, {
          window: { livePlayer: { getPlayerInfo: () => ({ liveStatus: status }) } },
        }),
      ),
  } as unknown as WebContents);

  await expect(page.liveStatus()).resolves.toBe(expected);
});

function createPageFixture() {
  const globals = {
    BilibiliLive: { UID: 0 },
    livePlayer: undefined as { setFullscreenStatus: (status: number) => void } | undefined,
  };

  const fetch = vi.fn().mockResolvedValue({
    json: async () => ({
      code: 0,
      data: { isLogin: true, mid: 42, uname: '测试账号', face: '' },
    }),
  });

  const addClass = vi.fn();
  const openLogin = vi.fn();
  const loadURL = vi.fn().mockResolvedValue(undefined);
  const page = new LivePage();

  page.attach({
    isDestroyed: () => false,
    getURL: () => 'https://live.bilibili.com/123',
    once: () => undefined,
    loadURL,
    executeJavaScript: (code: string) =>
      Promise.resolve(
        runInNewContext(code, {
          window: globals,
          fetch,
          document: {
            body: { classList: { add: addClass } },
            querySelector: (selector: string) =>
              selector === '.header-login-entry' ? { click: openLogin } : null,
          },
        }),
      ),
  } as unknown as WebContents);

  return { page, globals, fetch, addClass, openLogin, loadURL };
}

it('登录打开站内弹窗，不导航当前页面', async () => {
  const { page, openLogin, loadURL } = createPageFixture();

  await page.login();

  expect(openLogin).toHaveBeenCalledOnce();
  expect(loadURL).not.toHaveBeenCalled();
});

it('UID 为 0 时不读取账号 API，登录后才返回账号', async () => {
  const { page, globals, fetch } = createPageFixture();
  await expect(page.account()).resolves.toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();

  globals.BilibiliLive.UID = 42;
  await expect(page.account()).resolves.toMatchObject({ uid: 42, name: '测试账号' });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('登录轮询等待 UID 变化，只在成功后请求 API', async () => {
  vi.useFakeTimers();
  const { page, globals, fetch } = createPageFixture();
  const account = page.waitForLogin();
  await vi.advanceTimersByTimeAsync(3_000);
  expect(fetch).not.toHaveBeenCalled();

  globals.BilibiliLive.UID = 42;
  await vi.advanceTimersByTimeAsync(1_500);
  await expect(account).resolves.toMatchObject({ uid: 42 });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('登录超过六分钟后超时，并停止轮询', async () => {
  vi.useFakeTimers();
  const { page, fetch } = createPageFixture();
  const rejected = expect(page.waitForLogin()).rejects.toThrow('等待 Bilibili 登录超时');

  await vi.advanceTimersByTimeAsync(360_000);
  await rejected;
  expect(fetch).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('进房等待播放器挂载后设置网页全屏并隐藏侧栏', async () => {
  vi.useFakeTimers();
  const { page, globals, addClass } = createPageFixture();
  const opening = page.open(123);
  await vi.advanceTimersByTimeAsync(500);
  expect(addClass).not.toHaveBeenCalled();

  const setFullscreenStatus = vi.fn();
  globals.livePlayer = { setFullscreenStatus };
  await vi.advanceTimersByTimeAsync(500);
  await opening;
  expect(setFullscreenStatus).toHaveBeenCalledExactlyOnceWith(1);
  expect(addClass).toHaveBeenCalledExactlyOnceWith('hide-aside-area');
  expect(vi.getTimerCount()).toBe(0);
});

it('关闭页面取消登录等待，避免迟到的登录更新账号', async () => {
  const { page } = createPageFixture();
  const rejected = expect(page.waitForLogin()).rejects.toThrow('直播页面已切换或关闭');
  page.close();
  await rejected;
});

it('开发者工具只开在已绑定的直播 guest 上', () => {
  const page = new LivePage();
  expect(() => page.openDevTools()).toThrow('直播页面尚未绑定');

  const openDevTools = vi.fn();

  page.attach({
    isDestroyed: () => false,
    getURL: () => 'https://live.bilibili.com/123',
    once: () => undefined,
    openDevTools,
  } as unknown as WebContents);

  page.openDevTools();

  // 分离窗口：主窗口停靠式 devtools 会挤压 webview。
  expect(openDevTools).toHaveBeenCalledExactlyOnceWith({ mode: 'detach' });
});
