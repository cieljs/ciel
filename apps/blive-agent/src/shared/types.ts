import type { ASRModelId } from 'cieljs/hearing';

export type DanmakuDelivery = 'simulate' | 'live';

/** 可以打开开发者工具的目标；主进程只接受这个白名单里的值。 */
export type DevToolsTarget = 'live' | 'renderer';

export type RecordingSource = { type: 'url'; url: string } | { type: 'file'; path: string };

export type WatchMode =
  | { type: 'explore'; areaId: number }
  | { type: 'follow'; roomId: number }
  | { type: 'recording'; roomId: number; source: RecordingSource; date?: string; prompt?: string };

export interface StartWatchOptions {
  mode: WatchMode;
  danmakuDelivery?: DanmakuDelivery;
}

export interface WatchConfigurationStatus {
  path: string;
  valid: boolean;
  message?: string;
}

export interface HearingModelStatus {
  model?: ASRModelId;
  activeModel?: ASRModelId;
  availableModels?: readonly ASRModelId[];
  installing?: boolean;
  error?: string;
  progress?: {
    file: string;
    receivedBytes: number;
    totalBytes?: number;
    attempt?: number;
    message?: string;
  };
  modelsPath: string;
  missingFiles: readonly string[];
  valid: boolean;
}

export interface StreamerHistoryItem {
  id: string;
  type: 'dynamic' | 'video';
  title: string;
  publishedAt?: number;
  pinned: boolean;
  url?: string;
  summary?: string;
}

export interface Account {
  uid: number;
  name: string;
  face: string;
}

export interface LiveArea {
  id: number;
  name: string;
  children: readonly LiveArea[];
}

export interface RoomInfo {
  roomId: number;
  streamerUid: number;
  streamerName: string;
  title: string;
  description: string;
  parentAreaName: string;
  areaName: string;
  live: boolean;
}

export interface RoomCandidate {
  roomId: number;
  streamerUid: number;
  streamerName: string;
  title: string;
  areaName: string;
}

export type WatchStatus =
  | 'idle'
  | 'starting'
  | 'awaiting-login'
  | 'exploring'
  | 'opening'
  | 'watching'
  | 'stopping'
  | 'closed';

export type WatchEvent =
  | {
      type: 'video_progress';
      stage: 'extracting' | 'recognizing' | 'analyzing';
      processedSeconds?: number;
      totalSeconds?: number;
    }
  | { type: 'status'; status: WatchStatus }
  | { type: 'room_opened'; room: RoomInfo; sessionId: string }
  | { type: 'room_closed'; roomId: number; reason: string }
  | { type: 'exploration_started'; areaId: number }
  | { type: 'room_selected'; roomId: number; reason: string }
  | { type: 'thought_started'; triggerCount: number }
  | { type: 'thought_finished'; durationMs: number }
  | { type: 'room_evaluated'; score: number; confidence: number; action: 'stay' | 'explore' }
  | { type: 'danmaku_deferred'; reason: string }
  | { type: 'danmaku_simulated'; content: string }
  | { type: 'danmaku_submitted'; content: string; roomId: number }
  | { type: 'asr_subtitle'; content: string }
  | { type: 'recording_finished'; roomId: number }
  | { type: 'error'; stage: string; error: Error };
