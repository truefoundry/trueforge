import type { SessionEventsCache } from '@truefoundry/trueforge-assistant-ui-runtime';
import type { AgentUIServer, ListSessionsParams } from './types.js';

/** Cached pages go stale after this window so external session changes surface. */
const SESSION_LIST_TTL_MS = 30_000;

type SessionListPage = ReturnType<AgentUIServer['listSessions']>;

type CacheEntry = { at: number; page: SessionListPage };

export type SessionListCache = Map<string, CacheEntry>;

export function createSessionListCache(): SessionListCache {
  return new Map();
}

// `startTimestamp` is a rolling "now − 1 year" that differs on every call;
// keying on it would make each request unique and defeat the cache.
function cacheKey(request: ListSessionsParams | undefined): string {
  const rest: ListSessionsParams = { ...request };
  delete rest.startTimestamp;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

/** Deduplicates session pages and invalidates them after mutations or TTL expiry. */
export function withSessionListCache({
  server,
  cache,
  sessionEventsCache,
}: {
  server: AgentUIServer;
  cache: SessionListCache;
  sessionEventsCache?: SessionEventsCache;
}): AgentUIServer {
  const { deleteSession, renameSession } = server;
  return {
    ...server,
    listSessions(request) {
      const key = cacheKey(request);
      const now = Date.now();
      const entry = cache.get(key);
      if (entry !== undefined && now - entry.at < SESSION_LIST_TTL_MS) return entry.page;
      const page = server.listSessions(request);
      cache.set(key, { at: now, page });
      // Allow failed pages to be retried.
      void page.catch(() => {
        if (cache.get(key)?.page === page) cache.delete(key);
      });
      return page;
    },
    async createSession(request) {
      const result = await server.createSession(request);
      cache.clear();
      return result;
    },
    async updateSession(request) {
      const result = await server.updateSession(request);
      cache.clear();
      return result;
    },
    ...(deleteSession != null
      ? {
          deleteSession: async (request: { sessionId: string }) => {
            await deleteSession.call(server, request);
            sessionEventsCache?.invalidate(request.sessionId);
            cache.clear();
          },
        }
      : {}),
    ...(renameSession != null
      ? {
          renameSession: async (request: { sessionId: string; title: string }) => {
            await renameSession.call(server, request);
            sessionEventsCache?.updateMetadata(request.sessionId, { title: request.title });
            cache.clear();
          },
        }
      : {}),
  };
}
