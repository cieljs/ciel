import { createRouterClient } from '@orpc/server';
import type { BrowserWindow } from 'electron';
import { expect, it, vi } from 'vite-plus/test';

import type { LivePage } from '../bilibili/live-page.ts';
import { BROWSE_HOME } from '../browse-window.ts';
import { createWindowRoutes } from './window.ts';

const { fromId, MockBrowserWindow, windows } = vi.hoisted(() => {
  const windows: MockBrowserWindow[] = [];

  class MockBrowserWindow {
    readonly webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      loadURL: vi.fn().mockResolvedValue(undefined),
    };
    readonly focus = vi.fn();
    readonly destroy = vi.fn();
    readonly on = vi.fn();

    constructor() {
      windows.push(this);
    }

    isDestroyed() {
      return false;
    }
  }

  return { fromId: vi.fn(), MockBrowserWindow, windows };
});

vi.mock('electron', () => ({ webContents: { fromId }, BrowserWindow: MockBrowserWindow }));

it('直播间新窗口转成确认请求，外部链接不触发单推', async () => {
  const host = {};
  const setWindowOpenHandler = vi.fn();
  const loadURL = vi.fn().mockResolvedValue(undefined);

  fromId.mockReturnValue({
    isDestroyed: () => false,
    hostWebContents: host,
    getURL: () => 'https://live.bilibili.com/',
    setWindowOpenHandler,
    loadURL,
  });

  const requestRoom = vi.fn();

  const client = createRouterClient(
    createWindowRoutes(
      { webContents: host } as BrowserWindow,
      { attach: vi.fn() } as unknown as LivePage,
      requestRoom,
    ),
  );

  await client.attach({ id: 1 });
  const open = setWindowOpenHandler.mock.calls[0]![0];
  expect(open({ url: 'https://live.bilibili.com/123?from=home' })).toEqual({ action: 'deny' });
  expect(requestRoom).toHaveBeenCalledExactlyOnceWith(123);
  expect(loadURL).not.toHaveBeenCalled();

  for (const url of [
    'https://live.bilibili.com/all',
    'https://live.bilibili.com/p/eden/area-tags?parentAreaId=9&areaId=0',
    'https://space.bilibili.com/194484313',
  ]) {
    expect(open({ url })).toEqual({ action: 'deny' });
    expect(loadURL).toHaveBeenLastCalledWith(url);
  }

  loadURL.mockClear();

  for (const url of ['https://example.com/123', 'javascript:alert(1)']) {
    expect(open({ url })).toEqual({ action: 'deny' });
  }

  expect(requestRoom).toHaveBeenCalledOnce();
  expect(loadURL).not.toHaveBeenCalled();
});

it('openBrowse 打开独立的 B 站浏览窗口，不碰直播 guest', async () => {
  const host = {};
  const requestRoom = vi.fn();

  const client = createRouterClient(
    createWindowRoutes(
      { webContents: host } as BrowserWindow,
      { attach: vi.fn() } as unknown as LivePage,
      requestRoom,
    ),
  );

  await client.openBrowse();

  expect(windows).toHaveLength(1);
  expect(windows[0]!.webContents.loadURL).toHaveBeenCalledExactlyOnceWith(BROWSE_HOME);
  expect(requestRoom).not.toHaveBeenCalled();
});

it('openDevTools 只在白名单目标里选，两个目标各开各的', async () => {
  const openDevTools = vi.fn();
  const liveDevTools = vi.fn();
  const mainWindow = { webContents: { openDevTools } } as unknown as BrowserWindow;

  const client = createRouterClient(
    createWindowRoutes(mainWindow, { openDevTools: liveDevTools } as unknown as LivePage, vi.fn()),
  );

  await client.openDevTools({ target: 'live' });
  expect(liveDevTools).toHaveBeenCalledOnce();
  expect(openDevTools).not.toHaveBeenCalled();

  await client.openDevTools({ target: 'renderer' });
  expect(openDevTools).toHaveBeenCalledExactlyOnceWith({ mode: 'detach' });

  // 白名单之外的目标在进入 handler 之前就被 schema 拒绝。
  await expect(client.openDevTools({ target: 'browse' } as never)).rejects.toThrow();
  expect(liveDevTools).toHaveBeenCalledOnce();
  expect(openDevTools).toHaveBeenCalledOnce();
});
