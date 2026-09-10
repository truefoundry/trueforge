'use client';

import { useCallback, useSyncExternalStore } from 'react';

import {
  readSessionShareSearch,
  replaceSessionShareSearch,
  SESSION_SHARE_CHANGE_EVENT,
  type SessionShareSearch,
  type SessionShareWrite,
} from '../utils/sessionShareUrl.js';

function subscribeShareSearch(onStoreChange: () => void): () => void {
  window.addEventListener('popstate', onStoreChange);
  window.addEventListener(SESSION_SHARE_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('popstate', onStoreChange);
    window.removeEventListener(SESSION_SHARE_CHANGE_EVENT, onStoreChange);
  };
}

function getShareSearchSnapshot(): string {
  return window.location.search;
}

function getServerShareSearchSnapshot(): string {
  return '';
}

/**
 * Session share query on `window.location`.
 * Does not use react-router, so it works with `withRouter` on or off.
 */
export function useSessionShareSearch(): SessionShareSearch & {
  updateShareSearch: (next: SessionShareWrite) => void;
} {
  const search = useSyncExternalStore(subscribeShareSearch, getShareSearchSnapshot, getServerShareSearchSnapshot);
  const updateShareSearch = useCallback((next: SessionShareWrite) => {
    replaceSessionShareSearch(next);
  }, []);

  return { ...readSessionShareSearch(search), updateShareSearch };
}
