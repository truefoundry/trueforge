import type { RemoteThreadListAdapter } from '@assistant-ui/core';

import type { AgentChatServer } from './server/types.js';
import { sessionListStartTimestamp } from './sessionListStartTimestamp.js';
import { getSession } from './sessions.js';
import { sessionToThreadMetadata } from './sessionThreadMetadata.js';

const THREAD_LIST_PAGE_SIZE = 20;

export function createTrueForgeThreadListAdapter(options: {
  server: AgentChatServer;
  agentName: string;
  /** When set, filters `listSessions` by this agent id. Omit for all chats. */
  listSessionsAgentId?: string;
  /** Restrict history to sessions created by the authenticated subject. */
  listSessionsCreatedByMe?: boolean;
}): RemoteThreadListAdapter {
  const { server, agentName, listSessionsAgentId, listSessionsCreatedByMe = false } = options;

  return {
    async list({ after } = {}) {
      const page = await server.listSessions({
        ...(listSessionsAgentId != null ? { agentId: listSessionsAgentId } : {}),
        createdByMe: listSessionsCreatedByMe,
        limit: THREAD_LIST_PAGE_SIZE,
        ...(after == null ? {} : { pageToken: after }),
        startTimestamp: sessionListStartTimestamp(),
      });
      const threads = page.data.map(session => sessionToThreadMetadata(session, session.title ?? undefined));
      return {
        threads,
        nextCursor: page.nextPageToken ?? undefined,
      };
    },

    async initialize() {
      const session = await server.createSession({ agentName });
      return { remoteId: session.id, externalId: undefined };
    },

    async fetch(remoteId) {
      const session = await getSession(server, remoteId);
      return sessionToThreadMetadata(session, session.title ?? undefined);
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
