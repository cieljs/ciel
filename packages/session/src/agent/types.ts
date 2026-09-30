import type { SessionManager } from '../session-manager.ts';
import type { SessionSpace } from '../session-space.ts';
import type { Session } from '../session.ts';
import type { SessionInfo } from '../types.ts';

export type CrossSpaceAccess = 'related' | 'all';

export interface CrossSpaceOptions {
  manager: SessionManager;
  access: CrossSpaceAccess;
}

export interface SessionToolLimits {
  searchLimit?: number;
  maxReadMessages?: number;
}

export interface SessionToolsOptions extends SessionToolLimits {
  session: Session;
  space: SessionSpace;
  crossSpace?: CrossSpaceOptions;
  onSessionUpdated?: (session: SessionInfo) => void;
}

/** @internal */
export interface ResolvedToolOptions {
  searchLimit: number;
  maxReadMessages: number;
}
