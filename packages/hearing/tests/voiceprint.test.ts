import { describe, expect, it } from 'vite-plus/test';

import { averageEmbeddings } from '../src/voiceprint.ts';

describe('averageEmbeddings', () => {
  it('averages and normalizes multiple samples', () => {
    const voiceprint = averageEmbeddings([Float32Array.of(1, 0), Float32Array.of(0, 1)]);

    expect(voiceprint[0]).toBeCloseTo(Math.SQRT1_2);
    expect(voiceprint[1]).toBeCloseTo(Math.SQRT1_2);
  });
});
