import { RPCHandler } from '@orpc/server/message-port';
import { ipcMain, type BrowserWindow, type IpcMainEvent, type MessagePortMain } from 'electron';

import { createWatchApplication } from './application.ts';
import { isInvestigationWindowContents } from './investigation-window.ts';

export const WATCH_RPC_CHANNEL = 'blive-agent:rpc';

/** 只用到端口接入与断开，显式收窄以免把 oRPC 的私有泛型带进声明。 */
interface WatchRpcHandler {
  upgrade(port: MessagePortMain): void;
  close(port: MessagePortMain): Promise<void>;
}

/**
 * 同步登记 IPC 通道之后再异步准备存储与运行时：调用方可以立刻开始加载渲染进程，
 * 让渲染进程的加载和资源初始化并行。资源就绪前到达的端口先收下——MessagePort
 * 会把消息排队，接入 handler 后再投递，渲染进程的首个 RPC 不会因此丢失。
 */
export async function registerBliveAgentIpc(mainWindow: BrowserWindow) {
  const ports = new Set<MessagePortMain>();
  const waiting: MessagePortMain[] = [];
  let handler: WatchRpcHandler | undefined;

  const attach = (port: MessagePortMain) => {
    ports.add(port);

    port.on('close', () => {
      ports.delete(port);
    });

    handler!.upgrade(port);
    port.start();
  };

  const release = () => {
    for (const port of ports) {
      void handler?.close(port);
      port.close();
    }

    ports.clear();

    for (const port of waiting.splice(0)) {
      port.close();
    }
  };

  // 仅主窗口的主 frame 可建立连接，直播 guest 不能访问控制路由。
  const connect = (event: IpcMainEvent) => {
    const isMainWindow = !mainWindow.isDestroyed() && event.sender === mainWindow.webContents;
    const isInvestigationWindow = isInvestigationWindowContents(event.sender);

    const trusted =
      (isMainWindow || isInvestigationWindow) &&
      event.senderFrame === event.sender.mainFrame &&
      event.senderFrame.url === event.sender.getURL();

    if (!trusted || event.ports.length !== 1) {
      for (const port of event.ports) {
        port.close();
      }

      return;
    }

    const port = event.ports[0]!;

    if (handler) {
      attach(port);
    } else {
      waiting.push(port);
    }
  };

  const navigation = (_event: unknown, _url: string, _inPlace: boolean, isMainFrame: boolean) => {
    if (isMainFrame) {
      release();
    }
  };

  const detach = () => {
    ipcMain.removeListener(WATCH_RPC_CHANNEL, connect);
    mainWindow.webContents.removeListener('did-start-navigation', navigation);
    release();
  };

  // 先同步登记监听：调用方随后 loadURL，渲染进程的连接也不会丢。
  ipcMain.on(WATCH_RPC_CHANNEL, connect);
  mainWindow.webContents.on('did-start-navigation', navigation);

  try {
    await using resources = new AsyncDisposableStack();
    const application = await createWatchApplication(mainWindow);
    resources.defer(() => application.close());
    handler = new RPCHandler(application.router);

    for (const port of waiting.splice(0)) {
      attach(port);
    }

    const lifetime = resources.move();

    return async () => {
      detach();
      await lifetime.disposeAsync();
    };
  } catch (error) {
    // 初始化失败时窗口可能已经加载完，不能留下半套监听。
    detach();
    throw error;
  }
}
