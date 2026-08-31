import type { AgentChatServer, ListResult, SessionEventItem } from '../server/types.js';

const DEFAULT_PAGE_SIZE = 100;

/** Serve preloaded session events through `AgentChatServer.listEvents` pagination. */
export function createCachedListEventsBridge(itemsAsc: SessionEventItem[]): Pick<AgentChatServer, 'listEvents'> {
  const itemsNewestFirst = [...itemsAsc].reverse();

  return {
    async listEvents({ limit = DEFAULT_PAGE_SIZE, pageToken }) {
      const offset = pageToken == null || pageToken.length === 0 ? 0 : Number.parseInt(pageToken, 10);
      const start = Number.isFinite(offset) ? offset : 0;
      const data = itemsNewestFirst.slice(start, start + limit);
      const nextOffset = start + limit;
      const nextPageToken = nextOffset < itemsNewestFirst.length ? String(nextOffset) : undefined;
      const page: ListResult<SessionEventItem> = { data };
      return nextPageToken == null ? page : { ...page, nextPageToken };
    },
  };
}
