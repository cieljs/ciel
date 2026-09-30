import path from 'node:path';

import { BrowserWindow, type WebContents } from 'electron';

import { isAllowedPageUrl } from './bilibili/page-executor.ts';

/** 浏览窗口的起始页；观看页的 webview 不受这个窗口影响。 */
export const BROWSE_HOME = 'https://www.bilibili.com/';

let browseWindow: BrowserWindow | undefined;

function navigate(contents: WebContents, url: string) {
  void contents.loadURL(url).catch(error => console.error('打开 Bilibili 页面失败', error));
}

/** 站内链接留在本窗口，站外一律不打开——与直播 guest 的策略一致。 */
function guardNavigation(window: BrowserWindow) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedPageUrl(url)) {
      navigate(window.webContents, url);
    }

    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedPageUrl(url)) {
      event.preventDefault();
    }
  });
}

/**
 * 单例浏览窗口：复用直播 webview 的持久化分区，登录态与观看页一致。
 *
 * 刻意不挂 preload——该窗口加载的是远端页面，不该拿到 RPC 端口；`ipc.ts` 的
 * 发送方校验本来也会拒绝它，这里是第二道防线。
 *
 * 只有显式传入 url 时才改变已有窗口的页面，否则单击按钮只会把它提到前台，
 * 免得把正在浏览的用户拽回首页。
 */
export function openBrowseWindow(url?: string): void {
  const target = url ?? BROWSE_HOME;

  if (!isAllowedPageUrl(target)) {
    throw new Error('只允许打开 Bilibili 页面');
  }

  const existing = browseWindow && !browseWindow.isDestroyed() ? browseWindow : undefined;

  if (existing) {
    if (url !== undefined) {
      navigate(existing.webContents, target);
    }

    existing.focus();

    return;
  }

  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 480,
    minHeight: 360,
    title: 'Bilibili',
    autoHideMenuBar: true,
    backgroundColor: '#18181b',
    icon: path.resolve(__dirname, '../../resources/icon.png'),
    webPreferences: {
      partition: 'persist:blive-agent',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  browseWindow = window;

  window.on('closed', () => {
    if (browseWindow === window) {
      browseWindow = undefined;
    }
  });

  guardNavigation(window);
  navigate(window.webContents, target);
}

/** 主窗口关闭时一并收掉，避免留下只剩浏览器的孤儿进程。 */
export function closeBrowseWindow(): void {
  const window = browseWindow;
  browseWindow = undefined;

  if (window && !window.isDestroyed()) {
    window.destroy();
  }
}
