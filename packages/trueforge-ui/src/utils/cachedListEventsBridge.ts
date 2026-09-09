import type { AgentChatServer, ListResult, SessionEventItem } from '../server/types.js';

const DEFAULT_PAGE_SIZE = 100;

/** Serve preloaded session events through `AgentChatServer.listEvents` pagination. */
export function createCachedListEventsBridge(
  itemsAsc: SessionEventItem[],
  options?: { allAtOnce?: boolean },
): Pick<AgentChatServer, 'listEvents'> {
  const itemsNewestFirst = [...itemsAsc].reverse();

  return {
    async listEvents({ limit = DEFAULT_PAGE_SIZE, pageToken }) {
      const offset = pageToken == null || pageToken.length === 0 ? 0 : Number.parseInt(pageToken, 10);
      const start = Number.isFinite(offset) ? offset : 0;
      // Agent Details already fetched the complete history; one page prevents
      // synthetic display boundaries from making the runtime stop before older turns.
      const pageSize = options?.allAtOnce === true ? itemsNewestFirst.length : limit;
      const data = itemsNewestFirst.slice(start, start + pageSize);
      const nextOffset = start + pageSize;
      const nextPageToken = nextOffset < itemsNewestFirst.length ? String(nextOffset) : undefined;
      const page: ListResult<SessionEventItem> = { data };
      return nextPageToken == null ? page : { ...page, nextPageToken };
    },
  };
}
