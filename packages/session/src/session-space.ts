import type { SessionServices } from './session.ts';
import { Session } from './session.ts';
import type {
  FindSessionsBySourceOptions,
  SessionInfo,
  SessionListOptions,
  SessionOptions,
  SessionSearchHit,
  SessionSearchOptions,
  SessionSourceHit,
} from './types.ts';

export interface SessionSpace {
  readonly spaceId: string;

  openSession(options?: SessionOptions): Promise<Session>;
  getSession(id: string): Promise<Session | null>;
  list(options?: SessionListOptions): Promise<SessionInfo[]>;
  search(query: string, options?: SessionSearchOptions): Promise<SessionSearchHit[]>;
  findSessionsBySource(
    query: string,
    options?: FindSessionsBySourceOptions,
  ): Promise<SessionSourceHit[]>;
}

export function createSessionSpace(services: SessionServices, spaceId: string): SessionSpace {
  const selector = { namespace: services.namespace, spaceId };

  return {
    spaceId,
    openSession: (options = {}) =>
      services.operate(async () => {
        const info = await services.repository.open(selector, options);

        return new Session(services, info.id, info.spaceId);
      }),
    getSession: id =>
      services.operate(async () => {
        const info = await services.repository.getInfo({ ...selector, sessionId: id });

        return info ? new Session(services, info.id, info.spaceId) : null;
      }),
    list: options => services.operate(() => services.repository.list(selector, options)),
    search: (query, options) =>
      services.operate(() => services.retrieval.search(selector, query, options)),
    findSessionsBySource: (query, options) =>
      services.operate(() => services.retrieval.findBySource(selector, query, options)),
  };
}
