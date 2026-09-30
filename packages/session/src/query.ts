import { and, eq, sql } from 'drizzle-orm';

import { retrievalChunks, sessionMessages, sessions } from './schema.ts';

export interface SessionSelector {
  namespace?: string;
  spaceId?: string;
  sessionId?: string;
}

export function sessionCondition(selector: SessionSelector) {
  return and(
    selector.namespace === undefined ? undefined : eq(sessions.namespace, selector.namespace),
    selector.spaceId === undefined ? undefined : eq(sessions.spaceId, selector.spaceId),
    selector.sessionId === undefined ? undefined : eq(sessions.id, selector.sessionId),
  );
}

export function messageCondition(selector: SessionSelector) {
  return and(
    selector.namespace === undefined
      ? undefined
      : sql`${sessionMessages.sessionId} IN (SELECT ${sessions.id} FROM ${sessions} WHERE ${sessions.namespace} = ${selector.namespace})`,
    selector.sessionId === undefined
      ? undefined
      : eq(sessionMessages.sessionId, selector.sessionId),
    selector.spaceId === undefined
      ? undefined
      : sql`${sessionMessages.sessionId} IN (SELECT ${sessions.id} FROM ${sessions} WHERE ${sessions.spaceId} = ${selector.spaceId})`,
  );
}

export function chunkCondition(selector: SessionSelector) {
  return and(
    selector.namespace === undefined
      ? undefined
      : sql`${retrievalChunks.sessionId} IN (SELECT ${sessions.id} FROM ${sessions} WHERE ${sessions.namespace} = ${selector.namespace})`,
    selector.sessionId === undefined
      ? undefined
      : eq(retrievalChunks.sessionId, selector.sessionId),
    selector.spaceId === undefined
      ? undefined
      : sql`${retrievalChunks.sessionId} IN (SELECT ${sessions.id} FROM ${sessions} WHERE ${sessions.spaceId} = ${selector.spaceId})`,
  );
}
