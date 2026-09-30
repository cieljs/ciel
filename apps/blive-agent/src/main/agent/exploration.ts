import type { Ciel } from 'cieljs';
import type { TraceHost } from 'cieljs/trace/host';

import type { WatchEvent } from '../../shared/types.ts';
import type { BilibiliApi } from '../bilibili/api.ts';
import {
  createCandidateSources,
  createExplorationQuestion,
  type PreviousVisit,
} from '../prompts/index.ts';
import { excludeRevisits, ROOM_REVISIT_COOLDOWN_MS, type RoomDeparture } from '../room-history.ts';
import { messageText, parseDecision, RoomSelectionSchema } from './decisions.ts';

/**
 * 候选必须来自本轮 API 结果，避免模型虚构或使用过期房间。
 * 冷却是宿主的硬保证：被排除的房间不进候选，模型选到也不会通过归属校验。
 */
export async function selectExplorationRoom(options: {
  areaId: number;
  signal: AbortSignal;
  ciel: Ciel;
  api: BilibiliApi;
  /** 上一段观看的现场信息；只有评分判定切房时才有。 */
  previous?: PreviousVisit;
  /** 当前仍在冷却期内的房间快照。 */
  cooling?: readonly RoomDeparture[];
  trace?: TraceHost;
  emit: (event: WatchEvent) => void;
}) {
  const { areaId, signal, ciel, api, previous, cooling = [], trace, emit } = options;
  const candidates = await api.rooms(areaId);
  signal.throwIfAborted();

  const filtered = excludeRevisits(candidates, {
    currentRoomId: previous?.room.roomId,
    cooling,
  });

  // 记录的是模型真正看到的候选；被冷却拿掉的另记一条，便于对照 API 原始结果。
  trace?.record('list_live_rooms', filtered.candidates, 'bilibili:exploration');

  if (filtered.cooled.length > 0) {
    trace?.record(
      'exclude_revisits',
      { currentRoomId: previous?.room.roomId, cooled: filtered.cooled, relaxed: filtered.relaxed },
      'bilibili:exploration',
    );
  }

  signal.throwIfAborted();

  if (candidates.length === 0) {
    throw new Error(`分区 ${areaId} 当前没有直播候选`);
  }

  if (filtered.candidates.length === 0) {
    throw new Error(
      filtered.cooled.length > 0
        ? `分区 ${areaId} 的直播候选都在冷却期内`
        : `分区 ${areaId} 当前没有其他直播候选`,
    );
  }

  const result = await ciel.investigate({
    target: { type: 'global' },
    signal,
    crossSpace: true,
    sources: createCandidateSources(areaId, filtered.candidates),
    question: createExplorationQuestion(filtered.candidates, {
      previous,
      cooled: filtered.cooled,
      relaxed: filtered.relaxed,
      cooldownMs: ROOM_REVISIT_COOLDOWN_MS,
    }),
  });

  signal.throwIfAborted();

  const selection = parseDecision(messageText(result.answer), RoomSelectionSchema);
  const candidate = filtered.candidates.find(item => item.roomId === selection.roomId);

  if (!candidate) {
    throw new Error(`Agent 选择的直播间 ${selection.roomId} 不在本轮候选中`);
  }

  emit({ type: 'room_selected', roomId: candidate.roomId, reason: selection.reason });

  return api.room(candidate.roomId);
}
