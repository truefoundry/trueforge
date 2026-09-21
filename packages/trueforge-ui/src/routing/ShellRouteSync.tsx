'use client';

import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { ShellRouteSyncCore, type ReadWindowLocation, type ShellRouteNavigate } from './ShellRouteSyncCore.js';
import type { ResolvedRoutes } from './types.js';

/**
 * Single bidirectional bridge between shell state and the browser URL. Mounted under
 * `ShellModeProvider` but outside the keyed chat runtime so boot applies once.
 */
export function ShellRouteSync({
  routes,
  activeRemoteId,
  initialSettingsOpen,
}: {
  routes: ResolvedRoutes;
  activeRemoteId: string | undefined;
  initialSettingsOpen: boolean;
}) {
  const routerNavigate = useNavigate();
  const location = useLocation();

  const navigate = useCallback<ShellRouteNavigate>(
    (to, options) => {
      routerNavigate(to, options);
    },
    [routerNavigate],
  );

  const readWindowLocation = useCallback<ReadWindowLocation>(() => {
    return { pathname: window.location.pathname, search: window.location.search };
  }, []);

  return (
    <ShellRouteSyncCore
      routes={routes}
      activeRemoteId={activeRemoteId}
      initialSettingsOpen={initialSettingsOpen}
      location={{ pathname: location.pathname, search: location.search, hash: location.hash }}
      navigate={navigate}
      readWindowLocation={readWindowLocation}
    />
  );
}
