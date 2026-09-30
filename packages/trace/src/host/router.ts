import type { TraceHost } from './host.ts';
import { createEventRoutes } from './routes/events.ts';
import {
  createEntryRoutes,
  createMessageRoutes,
  createRunRoutes,
  createStepRoutes,
} from './routes/queries.ts';
import { createUpdatesProcedure } from './routes/updates.ts';
import { createValueRoutes } from './routes/values.ts';

export interface TraceRouterOptions {
  session?: (sessionId: string) => boolean;
}

/** 仅组装公开路由；输入校验、查询和订阅生命周期由各路由模块维护。 */
export function createTraceRouter(host: TraceHost, options: TraceRouterOptions = {}) {
  return {
    runs: createRunRoutes(host, options),
    steps: createStepRoutes(host, options),
    entries: createEntryRoutes(host, options),
    messages: createMessageRoutes(host),
    values: createValueRoutes(host),
    events: createEventRoutes(host),
    updates: createUpdatesProcedure(host, options),
  };
}

export type TraceRouter = ReturnType<typeof createTraceRouter>;
