import type { RoomCandidate, RoomInfo, WatchMode } from '../../shared/types.ts';
import type { RoomDeparture } from '../room-history.ts';

export interface SentDanmaku {
  content: string;
  sentAt: number;
}

/** 上一段观看的现场事实；不带上一轮的评分与证据，免得旧评价主导新一轮选择。 */
export interface PreviousVisit {
  room: RoomInfo;
  watchedSeconds: number;
  reason: string;
}

export interface ExplorationContext {
  /** 刚离开的房间；只有宿主判定切房时才存在。 */
  previous?: PreviousVisit;
  /** 本轮候选里仍在冷却期内的房间，最久没看的在前。 */
  cooled: readonly RoomDeparture[];
  /** 冷却原本会清空候选，已放宽。 */
  relaxed: boolean;
  /** 冷却窗口，用来算每个房间还剩多久。 */
  cooldownMs: number;
}

export function createRoomContext(input: {
  room: RoomInfo;
  mode: WatchMode;
  startedAt: number;
  canSwitch: boolean;
  history: readonly SentDanmaku[];
}): string {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - input.startedAt) / 1_000));

  const danmakuHistory = input.history.length
    ? input.history
        .slice(-10)
        .map(item => `- ${new Date(item.sentAt).toISOString()} ${item.content}`)
        .join('\n')
    : '（尚未提交弹幕）';

  const recordingSource =
    input.mode.type === 'recording'
      ? `\n- 录播来源：${input.mode.source.type === 'url' ? input.mode.source.url : input.mode.source.path}`
      : '';

  return `
# 当前${input.mode.type === 'recording' ? '录播' : '直播间'}

- 主播：${input.room.streamerName}（UID：${input.room.streamerUid}）
- 房间：${input.room.roomId}
- 标题：${input.room.title}
- 分区：${input.room.parentAreaName} / ${input.room.areaName}
- 简介：${input.room.description || '无'}
- 已观察：${elapsedSeconds} 秒
- 当前允许切换：${input.canSwitch ? '是' : '否'}
${recordingSource}

${input.mode.type === 'recording' ? '' : `# 当前访问已提交到页面的弹幕（最近 10 条）\n\n${danmakuHistory}`}
`.trim();
}

export function createExplorationQuestion(
  candidates: readonly RoomCandidate[],
  context: ExplorationContext,
): string {
  const blocks = [
    '从下面这批真实候选中选择一个最值得进一步观看和自然互动的直播间。只能返回一个 JSON 对象：\n{"roomId":123,"reason":"选择原因"}',
  ];

  // 数据段落随现场变化，没有就整段不出现；冷却规则和不要重进的约束在系统提示词里。
  if (context.previous) {
    blocks.push(formatPrevious(context.previous));
  }

  if (context.cooled.length > 0) {
    blocks.push(formatCooled(context.cooled, context));
  }

  blocks.push(`候选：\n${JSON.stringify(candidates)}`);

  return blocks.join('\n\n');
}

function formatPrevious(previous: PreviousVisit): string {
  const { room } = previous;

  return `# 上一段观看

刚离开：${room.streamerName}（房间 ${room.roomId}）· ${room.title}
分区：${room.parentAreaName} / ${room.areaName}
已观看 ${formatDuration(previous.watchedSeconds)}，离开原因：${previous.reason}。
它已从下面的候选中移除，不要选它。`;
}

function formatCooled(cooled: readonly RoomDeparture[], context: ExplorationContext): string {
  const now = Date.now();

  const lines = cooled.map(item => {
    const elapsedMs = Math.max(0, now - item.leftAt);
    const leftMinutes = Math.max(1, Math.ceil((context.cooldownMs - elapsedMs) / 60_000));

    return `- ${item.streamerName}（房间 ${item.roomId}）· ${item.title} · 离开 ${Math.floor(elapsedMs / 60_000)} 分钟，还有 ${leftMinutes} 分钟`;
  });

  return context.relaxed
    ? `# 冷却中的房间

本分区没有别的候选，冷却已放宽，下面这些最近看过的房间仍在候选里（按离开时间从早到晚）：
${lines.join('\n')}

只有确实没有更合适的选择时才回到它们。`
    : `# 冷却中的房间

以下房间最近看过，已从候选中移除：
${lines.join('\n')}`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);

  return minutes > 0 ? `${minutes} 分 ${total % 60} 秒` : `${total} 秒`;
}
