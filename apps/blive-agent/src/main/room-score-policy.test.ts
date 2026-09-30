import { describe, expect, it } from 'vite-plus/test';

import { RoomScorePolicy } from './room-score-policy.ts';

describe('RoomScorePolicy', () => {
  it('明确不感兴趣时当轮切换，不要求再次确认', () => {
    const policy = new RoomScorePolicy();

    expect(policy.evaluate({ action: 'explore', confidence: 0.9, score: 40 })).toEqual({
      shouldSwitch: true,
      reason: 'confirmed-explore',
    });

    expect(policy.evaluate({ action: 'explore', confidence: 0.7, score: 40 })).toEqual({
      shouldSwitch: false,
    });
  });

  it('连续两轮极低分后切换', () => {
    const policy = new RoomScorePolicy();

    expect(policy.evaluate({ action: 'stay', confidence: 0.8, score: 20 })).toEqual({
      shouldSwitch: false,
    });

    expect(policy.evaluate({ action: 'stay', confidence: 0.8, score: 19 })).toEqual({
      shouldSwitch: true,
      reason: 'sustained-low-score',
    });
  });

  it('高分会清空此前的低分窗口', () => {
    const policy = new RoomScorePolicy();

    policy.evaluate({ action: 'explore', confidence: 0.8, score: 30 });
    policy.evaluate({ action: 'stay', confidence: 0.8, score: 70 });

    expect(policy.evaluate({ action: 'explore', confidence: 0.8, score: 30 })).toEqual({
      shouldSwitch: false,
    });
  });
});
