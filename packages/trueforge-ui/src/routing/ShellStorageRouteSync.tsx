'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { resolveRoutesConfig } from './paths.js';
import { useShellLocationStore } from './ShellLocationContext.js';
import { ShellRouteSyncCore, type ShellRouteNavigate } from './ShellRouteSyncCore.js';

/**
 * Bidirectional bridge between shell state and a sessionStorage-backed location.
 * Mounted when `withRouter` is off so navigation survives reloads without touching the host URL.
 */
export function ShellStorageRouteSync({
  activeRemoteId,
  initialSettingsOpen,
}: {
  activeRemoteId: string | undefined;
  initialSettingsOpen: boolean;
}) {
  const store = useShellLocationStore();
  const routes = useMemo(() => resolveRoutesConfig(undefined), []);
  const location = useSyncExternalStore(store.subscribe, store.getLocation, store.getLocation);

  const navigate = useCallback<ShellRouteNavigate>(
    (to, options) => {
      store.navigate(to, options);
    },
    [store],
  );

  return (
    <ShellRouteSyncCore
      routes={routes}
      activeRemoteId={activeRemoteId}
      initialSettingsOpen={initialSettingsOpen}
      location={location}
      navigate={navigate}
    />
  );
}
