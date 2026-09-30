import path, { join } from 'node:path';

import { app, BrowserWindow, type WebContents } from 'electron';

let investigationWindow: BrowserWindow | undefined;

export function openInvestigationWindow(): void {
  if (investigationWindow && !investigationWindow.isDestroyed()) {
    investigationWindow.show();
    investigationWindow.focus();

    return;
  }

  const window = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 680,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    title: 'Ciel · Investigation',
    titleBarStyle: 'hidden',
    icon: path.resolve(__dirname, '../../resources/icon.png'),
    titleBarOverlay: { color: '#18181b', symbolColor: '#eaddea', height: 35 },
    backgroundColor: '#18181b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  investigationWindow = window;

  window.on('closed', () => {
    if (investigationWindow === window) {
      investigationWindow = undefined;
    }
  });

  window.on('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL']);
    url.searchParams.set('view', 'investigation');
    void window.loadURL(url.href);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { view: 'investigation' },
    });
  }
}

export function isInvestigationWindowContents(contents: WebContents): boolean {
  return investigationWindow?.webContents === contents && !investigationWindow.isDestroyed();
}

export function closeInvestigationWindow(): void {
  if (investigationWindow && !investigationWindow.isDestroyed()) {
    investigationWindow.destroy();
  }

  investigationWindow = undefined;
}
