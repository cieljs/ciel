import type { ASRModelId } from 'cieljs/hearing';

import type {
  Account,
  DevToolsTarget,
  HearingModelStatus,
  LiveArea,
  RoomInfo,
  StartWatchOptions,
  WatchEvent,
  WatchStatus,
  WatchConfigurationStatus,
} from './types.ts';

export const BLIVE_AGENT_IPC = {
  attachLiveWebContents: 'blive-agent:live-page:attach',
  start: 'blive-agent:start',
  stop: 'blive-agent:stop',
  login: 'blive-agent:login',
  logout: 'blive-agent:logout',
  account: 'blive-agent:account',
  areas: 'blive-agent:areas',
  snapshot: 'blive-agent:snapshot',
  event: 'blive-agent:event',
} as const;

export type WatchBridgeEvent =
  | { type: 'room_requested'; roomId: number }
  | Exclude<WatchEvent, { type: 'error' }>
  | { type: 'error'; stage: string; message: string };
export interface WatchSnapshot {
  status: WatchStatus;
  room?: RoomInfo;
}

export interface BliveAgentBridge {
  attachLiveWebContents(input: { id: number }): Promise<void>;
  openBrowseWindow(): Promise<void>;
  openInvestigationWindow(): Promise<void>;
  start(options: StartWatchOptions): Promise<void>;
  stop(): Promise<void>;
  /** 手动压缩当前会话上下文；返回是否产生了新的压缩摘要。 */
  compactContext(): Promise<boolean>;
  /** 打开直播 guest 或主窗口渲染进程的开发者工具。 */
  openDevTools(input: { target: DevToolsTarget }): Promise<void>;
  login(): Promise<Account>;
  logout(): Promise<void>;
  account(): Promise<Account | undefined>;
  areas(): Promise<readonly LiveArea[]>;
  configuration(): Promise<WatchConfigurationStatus>;
  hearingModels(): Promise<HearingModelStatus>;
  selectHearingModel(model: ASRModelId): Promise<HearingModelStatus>;
  installHearingModels(): Promise<HearingModelStatus>;
  pickRecordingFile(): Promise<string | undefined>;
  snapshot(): Promise<WatchSnapshot>;
  onEvent(listener: (event: WatchBridgeEvent) => void): () => void;
}
