import type { AgentChatServer, AgentSpec } from '../server/types.js';

export const DRAFT_SESSION_LAST_UPDATED_AT_HEADER = 'x-tfy-session-last-updated-at';

export interface DraftSessionBridge {
  syncAgentSpec: (draftSessionId: string, agentSpec: AgentSpec) => Promise<string>;
  getDraftAgentSpec: (draftSessionId: string) => Promise<AgentSpec>;
}

export function createDraftSessionBridge(server: AgentChatServer): DraftSessionBridge {
  return {
    async getDraftAgentSpec(draftSessionId) {
      const session = await server.getSession({ sessionId: draftSessionId });
      if (session.agentSpec == null) {
        throw new Error(`Session ${draftSessionId} has no agentSpec (isMutable=${String(session.isMutable)}).`);
      }
      return session.agentSpec;
    },

    async syncAgentSpec(draftSessionId, agentSpec) {
      const updated = await server.updateSession({
        sessionId: draftSessionId,
        agentSpec,
      });
      return updated.updatedAt;
    },
  };
}
