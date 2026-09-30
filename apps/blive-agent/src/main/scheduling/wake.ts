import type { WakeEvent } from 'cieljs/hearing';

export interface WatchWakeOptions {
  keywords: readonly string[];
  minWaitMs?: number;
  maxWaitMs?: number;
  cooldownMs?: number;
}

export function resolveWakeOptions(options: WatchWakeOptions): Required<WatchWakeOptions> {
  const resolved = {
    keywords: options.keywords,
    minWaitMs: options.minWaitMs ?? 1500,
    maxWaitMs: options.maxWaitMs ?? 4000,
    cooldownMs: options.cooldownMs ?? 15000,
  };

  if (!resolved.keywords.length || resolved.keywords.some(word => !word.trim())) {
    throw new Error('唤醒词不能为空');
  }

  if (
    ![resolved.minWaitMs, resolved.maxWaitMs, resolved.cooldownMs].every(
      value => Number.isFinite(value) && value >= 0,
    ) ||
    resolved.maxWaitMs < resolved.minWaitMs
  ) {
    throw new Error('唤醒等待时间必须非负，且 maxWaitMs 不能小于 minWaitMs');
  }

  return resolved;
}

/** 唤醒只让这一轮优先思考，宿主不会替 Ciel 应声；说什么由本轮内容决定。 */
export function createWakeContext(event: WakeEvent): string {
  return `\n\n# 本轮关键词唤醒\n\n${JSON.stringify({
    keyword: event.keyword,
    at: event.at.toISOString(),
  })}\n检测器在直播音频中命中了唤醒词，这不证明一定是主播在呼唤你。优先结合唤醒后的语音理解对方的话；如果问题尚未识别完整，不编造问题。被叫到不等于要马上开口：不要因为命中唤醒词就抢着发弹幕，按弹幕规则判断这一轮是否真的有自然内容，没有就 defer。`;
}
