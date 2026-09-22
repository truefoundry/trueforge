import type { AgentChatServer, Session } from './server/types.js';

const inflightBySessionId = new Map<string, Promise<Session>>();

/** `sessionId` is the assistant-ui thread `remoteId` from `RemoteThreadListAdapter.initialize`. */
export function getSession(server: AgentChatServer, sessionId: string): Promise<Session> {
  let inflight = inflightBySessionId.get(sessionId);
  if (inflight == null) {
    inflight = server.getSession({ sessionId }).finally(() => {
      if (inflightBySessionId.get(sessionId) === inflight) {
        inflightBySessionId.delete(sessionId);
      }
    });
    inflightBySessionId.set(sessionId, inflight);
  }
  return inflight;
}
