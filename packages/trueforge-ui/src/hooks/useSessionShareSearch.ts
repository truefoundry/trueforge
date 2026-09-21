'use client';

import { useCallback, useSyncExternalStore } from 'react';

import { useOptionalShellLocationStore } from '../routing/ShellLocationContext.js';
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

function subscribeNoop(): () => void {
  return () => {};
}

function getEmptySearchSnapshot(): string {
  return '';
}

/**
 * Session share query. Uses the sessionStorage-backed location when `withRouter`
 * is off; otherwise reads/writes `window.location` so it works with or without the router.
 */
export function useSessionShareSearch(): SessionShareSearch & {
  updateShareSearch: (next: SessionShareWrite) => void;
} {
  const locationStore = useOptionalShellLocationStore();

  const windowSearch = useSyncExternalStore(subscribeShareSearch, getShareSearchSnapshot, getServerShareSearchSnapshot);
  const storeSearch = useSyncExternalStore(
    locationStore?.subscribe ?? subscribeNoop,
    locationStore != null ? () => locationStore.getLocation().search : getEmptySearchSnapshot,
    getEmptySearchSnapshot,
  );

  const search = locationStore != null ? storeSearch : windowSearch;

  const updateShareSearch = useCallback(
    (next: SessionShareWrite) => {
      if (locationStore != null) {
        locationStore.updateSearch(next);
        return;
      }
      replaceSessionShareSearch(next);
    },
    [locationStore],
  );

  return { ...readSessionShareSearch(search), updateShareSearch };
}
