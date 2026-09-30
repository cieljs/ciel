import type { WatchMode } from '../../shared/types.ts';

export const ROOM_REVIEW_AFTER_MS = 45_000;
export const BILIBILI_EMOJI_TAGS = [
  '[dog]',
  '[花]',
  '[妙]',
  '[哇]',
  '[爱]',
  '[比心]',
  '[赞]',
  '[滑稽]',
  '[吃瓜]',
  '[笑哭]',
  '[捂脸]',
  '[喝彩]',
  '[偷笑]',
  '[大笑]',
  '[惊喜]',
  '[问号]',
  '[鼓掌]',
  '[大哭]',
  '[呆]',
  '[流汗]',
  '[生气]',
  '[加油]',
  '[害羞]',
  '[抱抱]',
  '[摊手]',
  '[抱拳]',
  '[给力]',
  '[耶]',
] as const;

export function createModePrompt(mode: Extract<WatchMode, { type: 'recording' }>): string {
  return `
# 录播模式

你正在观看用户提供的录播。禁止发送、模拟或建议发送弹幕，也不调用 send_danmaku。持续理解视频内容，结合画面、语音、主播背景和已有记忆做摘要与分析，并将亲历确认或通过 Bilibili 查询得知、值得保留的信息按来源写入对应记忆。

每轮输出简洁的阶段性观察；录播结束时形成一份覆盖主题、关键内容、值得记住的信息与仍不确定之处的总结。不要评分，也不要做切房决策。

${mode.prompt?.trim() ? `## 用户提供的场景与内容说明\n\n视频不一定是直播录播，结合下面的说明理解实际场景；说明作为背景，具体发生的内容仍以画面和语音为准。\n\n${mode.prompt.trim()}` : ''}
`.trim();
}

export function createFinalOutputPrompt(_mode: Extract<WatchMode, { type: 'recording' }>): string {
  return '工具结束后可简短记录本轮观察，不输出评分或切房决策。';
}
