import { queryOptions, type QueryClient } from '@tanstack/react-query';

import { queryKeys } from './queryKeys.js';
import { TURN_STATUS, type AgentUIServer, type ListSessionsParams, type Session } from './types.js';

/**
 * Turns started here and newer list rows invalidate detail explicitly, so this only bounds
 * changes made elsewhere. ponytail: another tab's finished turn can show for up to this long;
 * upgrade with server push of session `updatedAt`.
 */
const SESSION_DETAIL_STALE_TIME_MS = 30_000;

type SessionReader = Pick<AgentUIServer, 'getSession'>;

export function isLastTurnRunning(session: Pick<Session, 'lastTurnDetails'> | undefined): boolean {
  return session?.lastTurnDetails?.state.status === TURN_STATUS.RUNNING;
}

/**
 * Session detail through the shared cache; its `updatedAt` versions history pages. Pass `fresh`
 * once a turn settles so the new version lands; a cached running session is always refetched.
 */
export function sessionDetailQuery({
  server,
  sessionId,
  fresh = false,
}: {
  server: SessionReader;
  sessionId: string;
  fresh?: boolean;
}) {
  return queryOptions({
    queryKey: queryKeys.sessions.detail(sessionId),
    queryFn: () => server.getSession({ sessionId }),
    staleTime: query => (fresh || isLastTurnRunning(query.state.data) ? 0 : SESSION_DETAIL_STALE_TIME_MS),
  });
}

export function fetchSessionDetail({
  queryClient,
  ...options
}: Parameters<typeof sessionDetailQuery>[0] & { queryClient: QueryClient }): Promise<Session> {
  return queryClient.fetchQuery(sessionDetailQuery(options));
}

export function invalidateSessionLists(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.sessions.lists() });
}

function invalidateSessionDetail({ queryClient, sessionId }: { queryClient: QueryClient; sessionId: string }) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.detail(sessionId) });
}

/** When a list shows a session newer than its cached detail (another tab, a schedule), retire that detail. */
export function invalidateOutdatedSessionDetails({
  queryClient,
  sessions,
}: {
  queryClient: QueryClient;
  sessions: readonly Pick<Session, 'id' | 'updatedAt'>[];
}): void {
  for (const { id, updatedAt } of sessions) {
    const cached = queryClient.getQueryData<Session>(queryKeys.sessions.detail(id));
    if (cached != null && cached.updatedAt !== updatedAt) invalidateSessionDetail({ queryClient, sessionId: id });
  }
}

/** Drops every cached read for a deleted session and refreshes the lists that showed it. */
export function removeSessionQueries({ queryClient, sessionId }: { queryClient: QueryClient; sessionId: string }) {
  queryClient.removeQueries({ queryKey: queryKeys.sessions.detail(sessionId) });
  queryClient.removeQueries({ queryKey: queryKeys.sessionHistory.session(sessionId) });
  queryClient.removeQueries({ queryKey: queryKeys.sessions.grants(sessionId) });
  return invalidateSessionLists(queryClient);
}

// `startTimestamp` is a rolling "now − 1 year" that differs on every call;
// keying on it would make each request unique and defeat the cache.
function listKeyParams(request: ListSessionsParams | undefined): ListSessionsParams {
  const rest: ListSessionsParams = { ...request };
  delete rest.startTimestamp;
  return rest;
}

/** Routes session reads through the server QueryClient and invalidates them after session mutations. */
export function withSessionQueries({
  server,
  queryClient,
}: {
  server: AgentUIServer;
  queryClient: QueryClient;
}): AgentUIServer {
  const { deleteSession, renameSession } = server;
  return {
    ...server,
    listSessions(request) {
      return queryClient.fetchQuery({
        queryKey: queryKeys.sessions.list(listKeyParams(request)),
        queryFn: async () => {
          const page = await server.listSessions(request);
          invalidateOutdatedSessionDetails({ queryClient, sessions: page.data });
          return page;
        },
      });
    },
    getSession({ sessionId }) {
      return fetchSessionDetail({ queryClient, server, sessionId });
    },
    // A turn started or resumed here changes title, spec, and status, so the next detail read
    // must reach the server; once it reports `running`, every read refetches until the turn settles.
    createTurn(request) {
      invalidateSessionDetail({ queryClient, sessionId: request.sessionId });
      return server.createTurn(request);
    },
    sendTurnEvents(request) {
      invalidateSessionDetail({ queryClient, sessionId: request.sessionId });
      return server.sendTurnEvents(request);
    },
    async cancelSession(request) {
      await server.cancelSession(request);
      invalidateSessionDetail({ queryClient, sessionId: request.sessionId });
    },
    async listEvents(request) {
      const { sessionId, pageToken, lastTurnId } = request;
      // Rewinds read a branch-specific window, and a running turn appends events
      // without bumping `updatedAt`, so neither can be keyed by session version.
      if (lastTurnId != null) return server.listEvents(request);
      const session =
        queryClient.getQueryData<Session>(queryKeys.sessions.detail(sessionId)) ??
        (await fetchSessionDetail({ queryClient, server, sessionId }));
      if (isLastTurnRunning(session)) return server.listEvents(request);
      return queryClient.fetchQuery({
        queryKey: queryKeys.sessionHistory.page({
          sessionId,
          ...(pageToken == null ? {} : { pageToken }),
          version: session.updatedAt,
        }),
        queryFn: () => server.listEvents(request),
        staleTime: Infinity,
      });
    },
    async createSession(request) {
      const session = await server.createSession(request);
      queryClient.setQueryData(queryKeys.sessions.detail(session.id), session);
      void invalidateSessionLists(queryClient);
      return session;
    },
    async updateSession(request) {
      const session = await server.updateSession(request);
      queryClient.setQueryData(queryKeys.sessions.detail(session.id), session);
      void invalidateSessionLists(queryClient);
      return session;
    },
    ...(deleteSession != null
      ? {
          deleteSession: async (request: { sessionId: string }) => {
            await deleteSession.call(server, request);
            void removeSessionQueries({ queryClient, sessionId: request.sessionId });
          },
        }
      : {}),
    ...(renameSession != null
      ? {
          renameSession: async (request: { sessionId: string; title: string }) => {
            await renameSession.call(server, request);
            void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.detail(request.sessionId) });
            void invalidateSessionLists(queryClient);
          },
        }
      : {}),
  };
}
