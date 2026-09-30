import { createORPCClient, type ClientLink } from '@orpc/client';
import type { RouterClient } from '@orpc/server';

import type { TraceRouter } from '../host/router.ts';

export type TraceClient = RouterClient<TraceRouter>;

/** 应用选择 oRPC 适配器，并负责连接的建立、鉴权和释放。 */
export function createTraceClient(link: ClientLink<Record<never, never>>): TraceClient {
  return createORPCClient(link);
}
