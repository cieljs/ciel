import type { TraceUsageState, TraceUsage } from '@cieljs/trace/protocol';

export function emptyUsage(): TraceUsageState {
  return { total: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, context: null };
}

/** 缓存命中率只看输入侧：输出不会被缓存，算进去只会稀释比例。 */
export function cacheHitRate(usage: TraceUsage): number {
  const prompt = usage.input + usage.cacheRead + usage.cacheWrite;

  return prompt > 0 ? usage.cacheRead / prompt : 0;
}

/** 大数压成 k / M 并保留一位小数；小于一千按整数展示，读起来更快。 */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) {
    return '0';
  }

  if (tokens < 1000) {
    return String(Math.round(tokens));
  }

  if (tokens < 1_000_000) {
    return `${decimal(tokens / 1000)}k`;
  }

  return `${decimal(tokens / 1_000_000)}M`;
}

/** 命中率按百分比展示；满分直接写 100%，免得四舍五入成 100.0%。 */
export function formatPercent(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) {
    return '0%';
  }

  const percent = Math.min(rate, 1) * 100;

  if (percent >= 99.95) {
    return '100%';
  }

  return `${percent.toFixed(1)}%`;
}

function decimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}
