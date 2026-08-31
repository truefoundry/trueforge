'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  readSessionShareSearch,
  replaceSessionShareSearch,
  type SessionShareSearch,
} from '../utils/sessionShareUrl.js';

/**
 * Library session share query (`agentId`, `sessionId`) on `window.location`.
 * Does not use react-router, so it works with `withRouter` on or off.
 */
export function useSessionShareSearch(): SessionShareSearch & {
  updateShareSearch: (next: { sessionId?: string | null; agentId?: string | null }) => void;
} {
  const [search, setSearch] = useState(() => readSessionShareSearch(window.location.search));

  useEffect(() => {
    const sync = () => setSearch(readSessionShareSearch(window.location.search));
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const updateShareSearch = useCallback((next: { sessionId?: string | null; agentId?: string | null }) => {
    setSearch(readSessionShareSearch(replaceSessionShareSearch(next)));
  }, []);

  return { ...search, updateShareSearch };
}
