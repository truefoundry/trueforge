'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useToasterOptional } from '../containers/ToasterContainer.js';
import { useOptionalServer } from '../server/ServerContext.js';
import type { DirectoryUser } from '../server/types.js';

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_PAGE_SIZE = 25;

/** Debounced directory search for the invite input; an empty query lists nothing. */
export function useSessionUserSearch({ enabled }: { enabled: boolean }): {
  query: string;
  setQuery: (query: string) => void;
  users: DirectoryUser[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
} {
  const sessionAccess = useOptionalServer()?.sessionAccess;
  const toaster = useToasterOptional();
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  // Guards against out-of-order responses when the query changes mid-flight.
  const requestIdRef = useRef(0);

  const fetchPage = useCallback(
    async ({ term, pageToken }: { term: string; pageToken?: string }) => {
      if (sessionAccess == null) return;
      const requestId = ++requestIdRef.current;
      setLoading(true);
      try {
        const page = await sessionAccess.searchUsers({
          query: term,
          limit: SEARCH_PAGE_SIZE,
          ...(pageToken === undefined ? {} : { pageToken }),
        });
        if (requestId !== requestIdRef.current) return;
        setUsers(previous => {
          if (pageToken === undefined) return page.data;
          const seen = new Set(previous.map(user => user.id));
          return [...previous, ...page.data.filter(user => !seen.has(user.id))];
        });
        setNextPageToken(page.nextPageToken);
      } catch (caught) {
        if (requestId === requestIdRef.current) toaster?.showError(caught);
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [sessionAccess, toaster],
  );

  useEffect(() => {
    const term = query.trim();
    // Drop stale results/tokens and invalidate in-flight responses before debounce.
    requestIdRef.current++;
    setUsers([]);
    setNextPageToken(undefined);

    if (!enabled || sessionAccess == null || term.length === 0) {
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const timer = window.setTimeout(() => {
      void fetchPage({ term });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, fetchPage, query, sessionAccess]);

  const loadMore = useCallback(() => {
    if (nextPageToken == null || loading) return;
    void fetchPage({ term: query.trim(), pageToken: nextPageToken });
  }, [fetchPage, loading, nextPageToken, query]);

  return { query, setQuery, users, loading, hasMore: nextPageToken != null, loadMore };
}
