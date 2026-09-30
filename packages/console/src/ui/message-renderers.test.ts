import { expect, it, vi } from 'vite-plus/test';

import { messageRenderer, type MessageRendererMatch } from './message-renderers.ts';

const decision: MessageRendererMatch = {
  name: 'assistant',
  text: '{"action":"stay"}',
  json: { action: 'stay' },
};

it('第一个命中的渲染器胜出，后面的不再过问', () => {
  const later = vi.fn(() => true);

  const renderers = [
    { match: () => false, component: { name: 'rejected' } },
    {
      match: (message: MessageRendererMatch) => message.json !== undefined,
      component: { name: 'hit' },
    },
    { match: later, component: { name: 'later' } },
  ];

  expect(messageRenderer(decision, renderers)).toEqual({ name: 'hit' });
  expect(later).not.toHaveBeenCalled();
});

it('没有渲染器或都不命中时返回 undefined，交给默认渲染兜底', () => {
  const never = { match: () => false, component: { name: 'never' } };
  const assistantOnly = vi.fn((message: MessageRendererMatch) => message.name === 'user');

  expect(messageRenderer(decision, undefined)).toBeUndefined();
  expect(messageRenderer(decision, [])).toBeUndefined();
  expect(messageRenderer(decision, [never])).toBeUndefined();

  expect(
    messageRenderer(decision, [{ match: assistantOnly, component: { name: 'user' } }]),
  ).toBeUndefined();

  expect(assistantOnly).toHaveBeenCalledWith(decision);
});
