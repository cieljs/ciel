import type { TraceSession } from '@cieljs/trace/protocol';
import { expect, it } from 'vite-plus/test';

import { traceSessionLabel } from './session-label.ts';

const session = {
  id: 'bilibili:room:26966466:2026-09-15',
  startedAt: new Date('2026-09-15T03:54:00Z').getTime(),
  endedAt: new Date('2026-09-15T03:55:00Z').getTime(),
  usage: {
    total: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    context: null,
  },
  turn: 1,
  steps: 1,
  sources: ['bilibili:room:26966466', 'bilibili:streamer-name:%E6%AE%8B%E8%8C%B6Shiori'],
} satisfies TraceSession;

it('按日期、直播间 ID、主播名和标题组合 Session label', () => {
  const label = traceSessionLabel({ ...session, title: '直播复盘' });

  expect(label.split('·').slice(1)).toEqual(['26966466', '残茶Shiori', '直播复盘']);
});

it('没有标题时不追加标题或多余分隔符', () => {
  const label = traceSessionLabel(session);

  expect(label.split('·').slice(1)).toEqual(['26966466', '残茶Shiori']);
  expect(label).not.toContain('直播间 ');
});
