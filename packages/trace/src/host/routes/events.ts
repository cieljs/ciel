import { os } from '@orpc/server';
import * as z from 'zod';

import type { TraceHost } from '../host.ts';

/** 从已消费的事件序号继续，取消由宿主的持久化事件流处理。 */
export function createEventRoutes(host: TraceHost) {
  return {
    subscribe: os
      .input(z.object({ afterSequence: z.number().int().nonnegative().optional() }))
      .handler(({ input, signal }) => host.events(input.afterSequence, signal)),
  };
}
