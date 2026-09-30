import { Value } from 'typebox/value';
import { expect, it, vi } from 'vite-plus/test';

import { createDanmakuTool, DanmakuRunGate, type DanmakuToolContext } from './tools.ts';

function danmakuTool() {
  const context: DanmakuToolContext = {
    delivery: () => 'simulate',
    livePage: {} as DanmakuToolContext['livePage'],
    room: () => undefined,
    sentDanmaku: () => [],
    canSend: () => true,
    emit: vi.fn(),
  };

  return createDanmakuTool(context, new DanmakuRunGate());
}

it('弹幕理由只要求非空，长度不设上限', () => {
  const { parameters } = danmakuTool();

  expect(
    Value.Check(parameters, {
      action: 'defer',
      content: '',
      reason: '本轮没有合适的切入点。'.repeat(20),
    }),
  ).toBe(true);

  expect(Value.Check(parameters, { action: 'defer', content: '', reason: '' })).toBe(false);
});

it('弹幕正文仍受 40 字符硬上限约束', () => {
  const { parameters } = danmakuTool();

  expect(
    Value.Check(parameters, { action: 'send', content: '好'.repeat(40), reason: '理由' }),
  ).toBe(true);

  expect(
    Value.Check(parameters, { action: 'send', content: '好'.repeat(41), reason: '理由' }),
  ).toBe(false);
});

it('同一轮允许多次发送，间隔至少一秒', async () => {
  vi.useFakeTimers();

  try {
    const gate = new DanmakuRunGate();
    const send = vi.fn().mockResolvedValue(undefined);
    await gate.send(send);
    const second = gate.send(send);
    await vi.advanceTimersByTimeAsync(999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(send).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
