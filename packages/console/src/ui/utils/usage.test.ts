import type { TraceUsage } from '@cieljs/trace/protocol';
import { expect, it } from 'vite-plus/test';

import { cacheHitRate, formatPercent, formatTokens } from './usage.ts';

const usage = (values: Partial<TraceUsage>): TraceUsage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
  ...values,
});

it('token 数按量级压缩，小数只在 k 和 M 上出现', () => {
  expect(formatTokens(842)).toBe('842');
  expect(formatTokens(1284)).toBe('1.3k');
  expect(formatTokens(128_400)).toBe('128.4k');
  expect(formatTokens(1_000_000)).toBe('1M');
  expect(formatTokens(1_400_000)).toBe('1.4M');
});

it('没有用量或数值异常时显示 0', () => {
  expect(formatTokens(0)).toBe('0');
  expect(formatTokens(-1)).toBe('0');
  expect(formatTokens(Number.NaN)).toBe('0');
});

it('命中率只看输入侧，输出不参与', () => {
  expect(cacheHitRate(usage({ input: 100, cacheRead: 900, output: 500 }))).toBeCloseTo(0.9);
  expect(cacheHitRate(usage({ input: 100, cacheRead: 100, cacheWrite: 800 }))).toBeCloseTo(0.1);
  expect(cacheHitRate(usage({ output: 500 }))).toBe(0);
});

it('命中率按百分比展示，满分不写成 100.0%', () => {
  expect(formatPercent(0)).toBe('0%');
  expect(formatPercent(0.05)).toBe('5.0%');
  expect(formatPercent(0.748)).toBe('74.8%');
  expect(formatPercent(1)).toBe('100%');
  expect(formatPercent(Number.NaN)).toBe('0%');
});
