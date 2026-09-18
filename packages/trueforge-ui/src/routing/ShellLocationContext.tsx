'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { createShellLocationStore, type ShellLocationStore } from './shellLocationStore.js';

const ShellLocationContext = createContext<ShellLocationStore | null>(null);

/** Present only when the shell runs without `withRouter` (sessionStorage-backed location). */
export function ShellLocationProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => createShellLocationStore(), []);
  return <ShellLocationContext.Provider value={store}>{children}</ShellLocationContext.Provider>;
}

export function useOptionalShellLocationStore(): ShellLocationStore | null {
  return useContext(ShellLocationContext);
}

export function useShellLocationStore(): ShellLocationStore {
  const store = useContext(ShellLocationContext);
  if (store == null) {
    throw new Error('useShellLocationStore requires ShellLocationProvider');
  }
  return store;
}
