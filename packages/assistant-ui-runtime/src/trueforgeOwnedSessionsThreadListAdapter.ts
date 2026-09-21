import type { RemoteThreadListAdapter } from '@assistant-ui/core';

import type { AgentChatServer } from './server/types.js';
import { sessionListStartTimestamp } from './sessionListStartTimestamp.js';
import { sessionDisplayTitle, sessionToThreadMetadata } from './sessionThreadMetadata.js';

const THREAD_LIST_PAGE_SIZE = 20;

/**
 * Read-only thread-list adapter backed by `AgentChatServer.listSessions`.
 */
export function createTrueForgeOwnedSessionsThreadListAdapter(options: {
  server: AgentChatServer;
  /** When set, filters `listSessions` by this agent id. Omit for all chats. */
  listSessionsAgentId?: string;
  /** Restrict history to sessions created by the authenticated subject. */
  listSessionsCreatedByMe?: boolean;
}): RemoteThreadListAdapter {
  const { server, listSessionsAgentId, listSessionsCreatedByMe = false } = options;

  return {
    async list({ after } = {}) {
      const page = await server.listSessions({
        ...(listSessionsAgentId != null ? { agentId: listSessionsAgentId } : {}),
        createdByMe: listSessionsCreatedByMe,
        limit: THREAD_LIST_PAGE_SIZE,
        ...(after == null ? {} : { pageToken: after }),
        startTimestamp: sessionListStartTimestamp(),
      });
      const threads = page.data.map(session => sessionToThreadMetadata(session, sessionDisplayTitle(session)));
      return {
        threads,
        nextCursor: page.nextPageToken ?? undefined,
      };
    },

    initialize() {
      return Promise.reject(
        new Error('Owned sessions history adapter is read-only; create sessions via a named or draft runtime.'),
      );
    },

    async fetch(remoteId) {
      const session = await server.getSession({ sessionId: remoteId });
      return sessionToThreadMetadata(session, sessionDisplayTitle(session));
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
