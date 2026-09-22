import type { RemoteThreadListAdapter } from '@assistant-ui/core';

import type { AgentChatServer, AgentSpec } from '../server/types.js';
import { sessionListStartTimestamp } from '../sessionListStartTimestamp.js';
import { sessionDisplayTitle, sessionToThreadMetadata } from '../sessionThreadMetadata.js';

const THREAD_LIST_PAGE_SIZE = 20;

export function createTrueForgeDraftThreadListAdapter(options: {
  server: AgentChatServer;
  defaultAgentSpec: AgentSpec;
  getAgentSpec?: () => AgentSpec;
  /** When set, filters `listSessions` by this agent id. Omit for all chats. */
  listSessionsAgentId?: string;
  /** Restrict history to sessions created by the authenticated subject. */
  listSessionsCreatedByMe?: boolean;
}): RemoteThreadListAdapter {
  const { server, defaultAgentSpec, getAgentSpec, listSessionsAgentId, listSessionsCreatedByMe = false } = options;

  return {
    async list({ after } = {}) {
      const page = await server.listSessions({
        ...(listSessionsAgentId != null ? { agentId: listSessionsAgentId } : {}),
        createdByMe: listSessionsCreatedByMe,
        limit: THREAD_LIST_PAGE_SIZE,
        ...(after == null ? {} : { pageToken: after }),
        startTimestamp: sessionListStartTimestamp(),
      });
      const threads = page.data.map(session =>
        sessionToThreadMetadata(session, sessionDisplayTitle(session, defaultAgentSpec)),
      );
      return {
        threads,
        nextCursor: page.nextPageToken ?? undefined,
      };
    },

    async initialize() {
      const draft = await server.createSession({
        agentSpec: getAgentSpec?.() ?? defaultAgentSpec,
      });
      return { remoteId: draft.id, externalId: undefined };
    },

    async fetch(remoteId) {
      const draft = await server.getSession({ sessionId: remoteId });
      return sessionToThreadMetadata(draft, sessionDisplayTitle(draft, defaultAgentSpec));
    },

    async rename(remoteId, newTitle) {
      if (typeof server.renameSession !== 'function') {
        return;
      }
      await server.renameSession({ sessionId: remoteId, title: newTitle });
    },
    archive() {
      return Promise.resolve();
    },
    unarchive() {
      return Promise.resolve();
    },
    async delete(remoteId) {
      if (typeof server.deleteSession !== 'function') {
        return;
      }
      await server.deleteSession({ sessionId: remoteId });
    },

    generateTitle() {
      return Promise.resolve(new ReadableStream());
    },
  };
}
