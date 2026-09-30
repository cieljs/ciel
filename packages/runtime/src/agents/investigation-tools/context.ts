import type { MemoryManager } from '@cieljs/memory';
import type { SessionManager } from '@cieljs/session';

import type { InvestigationTarget } from '../../types.ts';

export interface InvestigationToolOptions {
  sessionManager: SessionManager;
  memoryManager: MemoryManager;
  investigationSessionId: string;
  target: InvestigationTarget;
  memoryAccess?: 'read' | 'read-write';
  crossSpace?: boolean;
  resolveSources: () => string[];
}

export function createInvestigationToolContext(options: InvestigationToolOptions) {
  const targetSpaceId = options.target.type === 'space' ? options.target.spaceId : 'global';

  return {
    options,
    targetSpaceId,
    sessionSpace: options.sessionManager.space(targetSpaceId),
    memorySpace: options.memoryManager.space(targetSpaceId),
  };
}

export type InvestigationToolContext = ReturnType<typeof createInvestigationToolContext>;

/** 结果附带宿主空间与来源；历史数据不能覆盖调查的身份边界。 */
export function investigationResult(details: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(details, null, 2) }], details };
}
