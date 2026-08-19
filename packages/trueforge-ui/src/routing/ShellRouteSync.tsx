'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useOptionalServer } from '../server/ServerContext.js';
import { useShellMode } from '../server/ShellModeContext.js';
import { deriveChatPlace, derivePlace } from './derivePlace.js';
import { buildPath, matchPath, placesEqual } from './paths.js';
import type { ResolvedRoutes, RoutePlace, ShellSnapshot } from './types.js';

/**
 * Single bidirectional bridge between shell state and the URL. Mounted under
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
  const shell = useShellMode();
  const server = useOptionalServer();
  const navigate = useNavigate();
  const location = useLocation();

  const snapshot: ShellSnapshot = {
    settingsOpen: shell.settingsOpen,
    pendingSessionId: shell.pendingSessionId,
    activeRemoteId,
    mode: shell.mode,
    agentConfigMode: shell.agentConfigMode,
  };

  const place = derivePlace(snapshot);
  const placeKey = JSON.stringify(place);

  // Guards. `selfNavPathRef` marks a path we navigated to ourselves so the
  // URL->shell effect does not re-apply it. `prevPlaceRef` powers push/replace.
  const selfNavPathRef = useRef<string | null>(null);
  const prevPlaceRef = useRef<RoutePlace | null>(null);
  const bootedRef = useRef(false);
  // Latest session id the URL asked for, so slower lookups cannot bind over it.
  const requestedSessionRef = useRef<string | null>(null);
  // Boot owns the first URL; the ongoing effects skip their initial commit so
  // they do not fight boot with the stale first-render place.
  const shellSyncStartedRef = useRef(false);
  const urlSyncStartedRef = useRef(false);

  /**
   * A URL carries only the id, so ask the server whether it names a mutable
   * draft or an agent chat; guessing "mutable" opens an agent session as a
   * blank draft. `requestedSessionRef` drops replies a later place superseded.
   */
  const openSession = useCallback(
    (sessionId: string) => {
      requestedSessionRef.current = sessionId;
      if (server == null) {
        shell.openHistorySession({ sessionId });
        return;
      }
      void server
        .getSession({ sessionId })
        .then(session => {
          if (requestedSessionRef.current !== sessionId) return;
          shell.openHistorySession({
            sessionId,
            isMutable: session.isMutable,
            ...(session.agentName != null ? { agentName: session.agentName } : {}),
          });
        })
        .catch(() => {
          if (requestedSessionRef.current !== sessionId) return;
          // Unreachable session: bind by id alone rather than stranding the shell.
          shell.openHistorySession({ sessionId });
        });
    },
    [server, shell],
  );

  const applyPlace = useCallback(
    (target: RoutePlace) => {
      switch (target.type) {
        case 'settings':
          shell.setSettingsOpen(true);
          return;
        case 'session':
          if (shell.pendingSessionId === target.sessionId || activeRemoteId === target.sessionId) return;
          openSession(target.sessionId);
          return;
        case 'agent':
          shell.selectLibraryAgent({ isMutable: false, agentName: target.agentName });
          return;
        case 'root':
          shell.setSettingsOpen(false);
          switch (shell.agentConfigMode) {
            case 'AgentLibrary':
              shell.openLibraryHome();
              return;
            case 'AgentComposer':
            case 'AgentLibraryWithComposer':
              shell.openDraft();
              return;
            case 'SingleAgent':
              shell.clearChat();
              return;
          }
      }
    },
    [shell, activeRemoteId, openSession],
  );

  // Boot: URL wins, except an explicit `initialSettingsOpen` overlay. Boot is the
  // sole authority for the first commit and sets the final URL + `prevPlaceRef`.
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    const urlPlace = matchPath(location.pathname, routes) ?? { type: 'root' };
    const settingsOnBoot = initialSettingsOpen || urlPlace.type === 'settings';

    if (urlPlace.type === 'settings') {
      shell.setSettingsOpen(true);
    } else {
      const chatPlace = deriveChatPlace(snapshot);
      if (!placesEqual(chatPlace, urlPlace)) applyPlace(urlPlace);
      if (initialSettingsOpen) shell.setSettingsOpen(true);
    }

    const desiredPlace: RoutePlace = settingsOnBoot ? { type: 'settings' } : urlPlace;
    const desiredPath = buildPath(desiredPlace, routes);
    prevPlaceRef.current = desiredPlace;
    if (desiredPath != null && desiredPath !== location.pathname) {
      selfNavPathRef.current = desiredPath;
      navigate({ pathname: desiredPath, search: location.search, hash: location.hash }, { replace: true });
    }
    // Boot runs once; snapshot is read imperatively here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shell -> URL: mirror the derived place. Skip the first commit (boot owns it).
  useEffect(() => {
    if (!bootedRef.current) return;
    if (!shellSyncStartedRef.current) {
      shellSyncStartedRef.current = true;
      return;
    }
    const target = buildPath(place, routes);
    if (target == null) return; // place has no configured URL (e.g. settings disabled)

    const prev = prevPlaceRef.current;
    prevPlaceRef.current = place;

    if (target === location.pathname) return;

    // Replace when a fresh chat just acquired its session id (same place, new id).
    const replace =
      place.type === 'session' && shell.pendingSessionId == null && prev != null && prev.type !== 'session';

    selfNavPathRef.current = target;
    // Only the pathname is ours; host query/hash state rides along unchanged.
    navigate({ pathname: target, search: location.search, hash: location.hash }, { replace });
    // location.pathname intentionally excluded: only react to shell-derived place changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeKey]);

  // URL -> shell: apply on genuine location changes (Back/Forward, manual edits).
  useEffect(() => {
    if (!bootedRef.current) return;
    if (!urlSyncStartedRef.current) {
      urlSyncStartedRef.current = true;
      return;
    }
    if (selfNavPathRef.current === location.pathname) {
      selfNavPathRef.current = null;
      return;
    }
    const urlPlace = matchPath(location.pathname, routes);
    if (urlPlace == null) {
      // Unknown path: normalize to root.
      const rootPath = routes.root;
      selfNavPathRef.current = rootPath;
      navigate({ pathname: rootPath, search: location.search, hash: location.hash }, { replace: true });
      applyPlace({ type: 'root' });
      return;
    }
    if (urlPlace.type !== 'settings' && shell.settingsOpen) {
      // Leaving settings via Back to a chat place.
      shell.setSettingsOpen(false);
    }
    applyPlace(urlPlace);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return null;
}
