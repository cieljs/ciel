import { os } from '@orpc/server';
import { webContents, type BrowserWindow } from 'electron';
import * as z from 'zod';

import type { LivePage } from '../bilibili/live-page.ts';
import { isAllowedPageUrl } from '../bilibili/page-executor.ts';
import { openBrowseWindow } from '../browse-window.ts';
import { openInvestigationWindow } from '../investigation-window.ts';

/** guest 必须属于当前窗口，避免渲染进程附加任意页面。 */
export function createWindowRoutes(
  mainWindow: BrowserWindow,
  livePage: LivePage,
  requestRoom: (roomId: number) => void,
) {
  return {
    attach: os.input(z.object({ id: z.number().int().positive() })).handler(({ input }) => {
      const contents = webContents.fromId(input.id);

      if (
        !contents ||
        contents.isDestroyed() ||
        contents.hostWebContents !== mainWindow.webContents ||
        !isAllowedPageUrl(contents.getURL())
      ) {
        throw new Error('直播 guest 不属于当前窗口或地址不合法');
      }

      livePage.attach(contents);

      contents.setWindowOpenHandler(({ url }) => {
        const target = URL.parse(url);
        const match = target?.pathname.match(/^\/(\d+)\/?$/u);
        const roomId = match ? Number(match[1]) : 0;

        if (
          target?.hostname === 'live.bilibili.com' &&
          ['https:', 'http:'].includes(target.protocol) &&
          Number.isSafeInteger(roomId) &&
          roomId > 0
        ) {
          requestRoom(roomId);
        } else if (target?.protocol === 'https:' && isAllowedPageUrl(url)) {
          // 分区和全部直播页也使用新窗口链接，改为在当前 webview 内浏览。
          void contents.loadURL(url).catch(error => console.error('打开 Bilibili 页面失败', error));
        }

        return { action: 'deny' };
      });
    }),

    // 顶栏按钮专用：只开浏览窗口，不接受外部 URL，也就不需要额外的白名单校验。
    openBrowse: os.handler(() => {
      openBrowseWindow();
    }),
    openInvestigation: os.handler(() => {
      openInvestigationWindow();
    }),
    // DevTools 目标走白名单枚举：渲染进程不能要求打开任意 WebContents 的开发者工具。
    openDevTools: os
      .input(z.object({ target: z.enum(['live', 'renderer']) }))
      .handler(({ input }) => {
        if (input.target === 'live') {
          livePage.openDevTools();

          return;
        }

        // 主窗口是隐藏标题栏加固定网格布局，停靠式 devtools 会挤掉 webview 的高度。
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      }),
  };
}
