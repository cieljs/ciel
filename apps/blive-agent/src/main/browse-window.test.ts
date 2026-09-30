import { beforeEach, expect, it, vi } from 'vite-plus/test';

const { MockBrowserWindow, windows } = vi.hoisted(() => {
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

  return { MockBrowserWindow, windows };
});

vi.mock('electron', () => ({ BrowserWindow: MockBrowserWindow }));

// 模块级单例要跨用例复位，否则上一个用例留下的窗口会串味。
beforeEach(() => {
  windows.length = 0;
  vi.resetModules();
});

it('首次打开创建窗口并停在 B 站首页', async () => {
  const { openBrowseWindow, BROWSE_HOME } = await import('./browse-window.ts');

  openBrowseWindow();

  expect(windows).toHaveLength(1);
  expect(windows[0]!.webContents.loadURL).toHaveBeenCalledExactlyOnceWith(BROWSE_HOME);
});

it('重复点击只聚焦已有窗口，不重复创建也不重置页面', async () => {
  const { openBrowseWindow } = await import('./browse-window.ts');

  openBrowseWindow();
  openBrowseWindow();

  expect(windows).toHaveLength(1);
  expect(windows[0]!.focus).toHaveBeenCalledOnce();
  expect(windows[0]!.webContents.loadURL).toHaveBeenCalledOnce();
});

it('关闭后可以重新创建', async () => {
  const { openBrowseWindow, closeBrowseWindow } = await import('./browse-window.ts');

  openBrowseWindow();
  closeBrowseWindow();
  expect(windows[0]!.destroy).toHaveBeenCalledOnce();

  openBrowseWindow();
  expect(windows).toHaveLength(2);
});

it('没开窗口时关闭是安全的', async () => {
  const { closeBrowseWindow } = await import('./browse-window.ts');

  expect(() => closeBrowseWindow()).not.toThrow();
});

it('站内链接留在本窗口，站外链接一律不打开', async () => {
  const { openBrowseWindow } = await import('./browse-window.ts');
  openBrowseWindow();

  const open = windows[0]!.webContents.setWindowOpenHandler.mock.calls[0]![0];
  const contents = windows[0]!.webContents;

  expect(open({ url: 'https://space.bilibili.com/194484313' })).toEqual({ action: 'deny' });
  expect(contents.loadURL).toHaveBeenLastCalledWith('https://space.bilibili.com/194484313');

  contents.loadURL.mockClear();

  for (const url of ['https://example.com/', 'javascript:alert(1)']) {
    expect(open({ url })).toEqual({ action: 'deny' });
  }

  expect(contents.loadURL).not.toHaveBeenCalled();
});

it('拒绝显式传入的非 B 站地址', async () => {
  const { openBrowseWindow } = await import('./browse-window.ts');

  expect(() => openBrowseWindow('https://example.com/')).toThrow('只允许打开 Bilibili 页面');
  expect(windows).toHaveLength(0);
});
