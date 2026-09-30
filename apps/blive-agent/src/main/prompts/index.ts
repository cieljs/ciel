import type { RoomCandidate, RoomInfo, WatchMode } from '../../shared/types.ts';
import { COMMON_SYSTEM_PROMPT } from './common.ts';
import { createLiveSystemPrompt } from './live.ts';
import { createFinalOutputPrompt, createModePrompt } from './modes.ts';
import { CIEL_PERSONA_PROMPT } from './persona.ts';

export { createExplorationQuestion, createRoomContext } from './context.ts';
export type { ExplorationContext, PreviousVisit, SentDanmaku } from './context.ts';
export { BILIBILI_EMOJI_TAGS, ROOM_REVIEW_AFTER_MS } from './modes.ts';
export { CIEL_PERSONA_PROMPT } from './persona.ts';
export { createPerceptionContext, HEARING_PROMPT } from './perception.ts';

/** 人设统一注入在系统提示词最前面；选房用的 `EXPLORATION_SYSTEM_PROMPT` 是纯决策提示词，不带人设。 */
export function createSystemPrompt(mode: WatchMode): string {
  const taskPrompt =
    mode.type !== 'recording'
      ? createLiveSystemPrompt(mode)
      : [
          COMMON_SYSTEM_PROMPT,
          createModePrompt(mode),
          `## 最终输出\n\n${createFinalOutputPrompt(mode)}`,
        ].join('\n\n');

  return `${CIEL_PERSONA_PROMPT}\n\n${taskPrompt}`;
}

export function createRoomSources(room: RoomInfo): string[] {
  return [
    `bilibili:room:${room.roomId}`,
    `bilibili:streamer:${room.streamerUid}`,
    `bilibili:streamer-name:${encodeURIComponent(room.streamerName.trim())}`,
  ];
}

export function createCandidateSources(areaId: number, _candidates: readonly RoomCandidate[]) {
  return [`bilibili:area:${areaId}`];
}
