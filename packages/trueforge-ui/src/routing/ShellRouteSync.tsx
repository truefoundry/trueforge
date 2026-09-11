'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { sessionIsCreateAgent } from '../atoms/lib/sessionCreateAgent.js';
import { findAgentByName } from '../atoms/lib/useSearchAgentsList.js';
import {
  useOptionalAgentSessionsServer,
  useOptionalCatalogServer,
  useOptionalScheduleServer,
  useOptionalServer,
  useServerCapabilities,
  useServerCapabilitiesSettled,
} from '../server/ServerContext.js';
import { libraryAgentId, useShellMode } from '../server/ShellModeContext.js';
import { toEffectiveRoutes } from '../server/serverChrome.js';
import {
  readHistoryAgentSearch,
  updateHistoryAgentSearch,
  type HistoryAgentSearch,
} from '../utils/historyAgentSearch.js';
import { deriveChatPlace, derivePlace } from './derivePlace.js';
import { buildPath, matchLocation, placesEqual, sanitizeSearchForPlace } from './paths.js';
import type { ResolvedRoutes, RoutePlace, ShellSnapshot } from './types.js';

// Filter intent follows chat history across chat/session URLs, but must not leak into unrelated surfaces.
function placeOwnsHistoryAgentSearch(place: RoutePlace): boolean {
  return place.type === 'root' || place.type === 'agent' || place.type === 'session';
}

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
  const catalog = useOptionalCatalogServer();
  const sessions = useOptionalAgentSessionsServer();
  const schedules = useOptionalScheduleServer();
  const capabilities = useServerCapabilities();
  const capabilitiesSettled = useServerCapabilitiesSettled();
  const navigate = useNavigate();
  const location = useLocation();
  // Same gates as sidebar chrome: missing optional ports unregister their paths.
  const effectiveRoutes = useMemo(
    () => toEffectiveRoutes({ routes, catalog, capabilities, sessions, schedules }),
    [routes, catalog, capabilities, sessions, schedules],
  );
  const settingsChromeEnabled = effectiveRoutes.settings != null;
  // Gate identity only — avoid re-syncing when capabilities object identity churns
  // without changing which paths are registered (would clobber window share query).
  const routeGatesKey = [
    effectiveRoutes.settings,
    effectiveRoutes.sessionsBrowser,
    effectiveRoutes.libraryAgent,
    effectiveRoutes.schedules,
  ].join('\0');

  const snapshot: ShellSnapshot = {
    settingsOpen: shell.settingsOpen,
    libraryOpen: shell.libraryOpen,
    sessionsOpen: shell.sessionsOpen,
    libraryAgentId: shell.libraryAgentId,
    schedulesOpen: shell.schedulesOpen,
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
  const appliedUrlPlaceRef = useRef<RoutePlace | null>(null);
  const bootedRef = useRef(false);
  const bootPlaceRef = useRef<RoutePlace | null>(null);
  const bootHistoryAgentRef = useRef<HistoryAgentSearch | null>(null);
  // Latest session id the URL asked for, so slower lookups cannot bind over it.
  const requestedSessionRef = useRef<string | null>(null);
  const requestedHistoryAgentRef = useRef<string | null>(null);
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
            isCreateAgent: sessionIsCreateAgent(session),
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

  const applyHistoryAgentSearch = useCallback(
    (next: HistoryAgentSearch | null) => {
      if (next == null) {
        requestedHistoryAgentRef.current = null;
        bootHistoryAgentRef.current = null;
        shell.setHistoryAgentFilter(null);
        return;
      }

      const requestKey = `${next.intent}\0${next.agentName}`;
      const current = shell.historyAgentFilter;
      if (current?.intent === next.intent && current.agentName === next.agentName && current.agentId != null) {
        requestedHistoryAgentRef.current = null;
        return;
      }

      requestedHistoryAgentRef.current = requestKey;
      shell.setHistoryAgentFilter(next);
      if (server == null) return;

      void findAgentByName({ server, agentName: next.agentName })
        .then(agent => {
          if (requestedHistoryAgentRef.current !== requestKey) return;
          if (agent == null) {
            requestedHistoryAgentRef.current = null;
            bootHistoryAgentRef.current = null;
            shell.setHistoryAgentFilter(null);
            return;
          }
          requestedHistoryAgentRef.current = null;
          shell.setHistoryAgentFilter({
            agentId: libraryAgentId(agent),
            agentName: agent.name,
            intent: next.intent,
          });
        })
        .catch(() => {
          if (requestedHistoryAgentRef.current !== requestKey) return;
          requestedHistoryAgentRef.current = null;
          bootHistoryAgentRef.current = null;
          shell.setHistoryAgentFilter(null);
        });
    },
    [server, shell],
  );

  const openAgent = useCallback(
    (agentName: string) => {
      shell.selectLibraryAgent({ isMutable: false, agentName });
      applyHistoryAgentSearch({ intent: 'try-agent', agentName });
    },
    [applyHistoryAgentSearch, shell],
  );

  const applyPlace = useCallback(
    (target: RoutePlace) => {
      switch (target.type) {
        case 'settings':
          shell.setSettingsOpen(true);
          return;
        case 'library':
          shell.setLibraryOpen(true);
          return;
        case 'sessionsBrowser':
          shell.setSessionsOpen(true);
          return;
        case 'libraryAgent':
          shell.openLibraryAgent(target.agentId);
          return;
        case 'schedules':
          shell.setSchedulesOpen(true);
          return;
        case 'buildAgent':
          shell.openAgentBuilder();
          return;
        case 'session':
          shell.setLibraryOpen(false);
          if (shell.pendingSessionId === target.sessionId || activeRemoteId === target.sessionId) return;
          openSession(target.sessionId);
          return;
        case 'agent':
          shell.setLibraryOpen(false);
          openAgent(target.agentName);
          return;
        case 'root':
          shell.setSettingsOpen(false);
          shell.setLibraryOpen(false);
          shell.setSchedulesOpen(false);
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
    [shell, activeRemoteId, openAgent, openSession],
  );

  // Boot: URL wins, except an explicit `initialSettingsOpen` overlay. Boot is the
  // sole authority for the first commit and sets the final URL + `prevPlaceRef`.
  useEffect(() => {
    if (bootedRef.current) return;
    const configuredUrlPlace = matchLocation({
      pathname: location.pathname,
      search: location.search,
      routes,
    });
    if (!capabilitiesSettled && configuredUrlPlace?.type === 'settings') return;
    bootedRef.current = true;

    const urlPlace = matchLocation({
      pathname: location.pathname,
      search: location.search,
      routes: effectiveRoutes,
    }) ?? { type: 'root' };
    const historyAgentSearch: HistoryAgentSearch | null =
      urlPlace.type === 'agent'
        ? { intent: 'try-agent', agentName: urlPlace.agentName }
        : placeOwnsHistoryAgentSearch(urlPlace)
          ? readHistoryAgentSearch(location.search)
          : null;
    bootHistoryAgentRef.current = historyAgentSearch;
    appliedUrlPlaceRef.current = urlPlace;
    const settingsOnBoot = settingsChromeEnabled && (initialSettingsOpen || urlPlace.type === 'settings');

    if (urlPlace.type === 'settings') {
      if (settingsChromeEnabled) shell.setSettingsOpen(true);
    } else if (urlPlace.type === 'library') {
      shell.setLibraryOpen(true);
    } else if (urlPlace.type === 'sessionsBrowser') {
      shell.setSessionsOpen(true);
    } else if (urlPlace.type === 'libraryAgent') {
      shell.openLibraryAgent(urlPlace.agentId);
    } else if (urlPlace.type === 'schedules') {
      shell.setSchedulesOpen(true);
    } else {
      const chatPlace = deriveChatPlace(snapshot);
      if (!placesEqual(chatPlace, urlPlace)) applyPlace(urlPlace);
      if (settingsOnBoot) shell.setSettingsOpen(true);
    }
    if (urlPlace.type !== 'agent' && historyAgentSearch != null) {
      applyHistoryAgentSearch(historyAgentSearch);
    } else if (!placeOwnsHistoryAgentSearch(urlPlace)) {
      applyHistoryAgentSearch(null);
    }

    const desiredPlace: RoutePlace = settingsOnBoot ? { type: 'settings' } : urlPlace;
    bootPlaceRef.current = placesEqual(place, desiredPlace) ? null : desiredPlace;
    const desiredPath = buildPath(desiredPlace, effectiveRoutes);
    const desiredSearch = updateHistoryAgentSearch(
      sanitizeSearchForPlace(desiredPlace, location.search),
      historyAgentSearch,
    );
    prevPlaceRef.current = desiredPlace;
    if (desiredPath != null && (desiredPath !== location.pathname || desiredSearch !== location.search)) {
      selfNavPathRef.current = desiredPath !== location.pathname ? desiredPath : null;
      navigate({ pathname: desiredPath, search: desiredSearch, hash: location.hash }, { replace: true });
    }
    // Boot runs once after any capability-dependent Settings destination resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capabilitiesSettled]);

  // Shell -> URL: mirror the derived place. Skip the first commit (boot owns it).
  useEffect(() => {
    if (!bootedRef.current) return;
    if (!shellSyncStartedRef.current) {
      shellSyncStartedRef.current = true;
      return;
    }
    const bootPlace = bootPlaceRef.current;
    if (bootPlace != null) {
      if (!placesEqual(place, bootPlace)) return;
      bootPlaceRef.current = null;
    }
    const target = buildPath(place, effectiveRoutes);
    if (target == null) return; // place has no configured URL (e.g. settings disabled)
    const basename = effectiveRoutes.basename.endsWith('/')
      ? effectiveRoutes.basename.slice(0, -1)
      : effectiveRoutes.basename;
    const browserPathname = `${basename}${location.pathname}` || '/';
    const latestSearch = window.location.pathname === browserPathname ? window.location.search : location.search;
    const ownsHistoryAgentSearch = placeOwnsHistoryAgentSearch(place);
    const historyAgentSearch = ownsHistoryAgentSearch
      ? shell.historyAgentFilter == null
        ? bootHistoryAgentRef.current
        : {
            intent: shell.historyAgentFilter.intent,
            agentName: shell.historyAgentFilter.agentName,
          }
      : null;
    if (!ownsHistoryAgentSearch && shell.historyAgentFilter != null) {
      requestedHistoryAgentRef.current = null;
      shell.setHistoryAgentFilter(null);
    }
    if (shell.historyAgentFilter != null) bootHistoryAgentRef.current = null;
    const targetSearch = updateHistoryAgentSearch(sanitizeSearchForPlace(place, latestSearch), historyAgentSearch);

    const prev = prevPlaceRef.current;
    prevPlaceRef.current = place;

    if (target === location.pathname && targetSearch === location.search) return;

    // Replace when a fresh chat just acquired its session id (same place, new id).
    const replace =
      place.type === 'session' && shell.pendingSessionId == null && prev != null && prev.type !== 'session';

    selfNavPathRef.current = target !== location.pathname ? target : null;
    // Query keys owned by other shell places are removed; host keys and hash survive.
    navigate({ pathname: target, search: targetSearch, hash: location.hash }, { replace });
    // location.pathname intentionally excluded: only react to shell-derived place changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeKey, routeGatesKey, shell.historyAgentFilter?.agentName, shell.historyAgentFilter?.intent]);

  // URL -> shell: apply on genuine location changes (Back/Forward, manual edits).
  useEffect(() => {
    if (!bootedRef.current) return;
    if (!urlSyncStartedRef.current) {
      urlSyncStartedRef.current = true;
      return;
    }
    if (selfNavPathRef.current === location.pathname) {
      selfNavPathRef.current = null;
      appliedUrlPlaceRef.current = place;
      return;
    }
    const urlPlace = matchLocation({
      pathname: location.pathname,
      search: location.search,
      routes: effectiveRoutes,
    });
    if (urlPlace == null) {
      // Unknown path: normalize to root.
      const rootPath = effectiveRoutes.root;
      const rootSearch = sanitizeSearchForPlace({ type: 'root' }, location.search);
      selfNavPathRef.current = rootPath;
      navigate({ pathname: rootPath, search: rootSearch, hash: location.hash }, { replace: true });
      applyPlace({ type: 'root' });
      applyHistoryAgentSearch(readHistoryAgentSearch(rootSearch));
      return;
    }
    const previousUrlPlace = appliedUrlPlaceRef.current;
    appliedUrlPlaceRef.current = urlPlace;
    if (previousUrlPlace == null || !placesEqual(previousUrlPlace, urlPlace)) {
      if (urlPlace.type !== 'settings' && shell.settingsOpen) {
        // Leaving settings via Back to a chat place.
        shell.setSettingsOpen(false);
      }
      if (urlPlace.type !== 'library' && urlPlace.type !== 'libraryAgent' && shell.libraryOpen) {
        shell.setLibraryOpen(false);
      }
      if (urlPlace.type !== 'sessionsBrowser' && shell.sessionsOpen) {
        shell.setSessionsOpen(false);
      }
      if (urlPlace.type !== 'schedules' && shell.schedulesOpen) {
        // Leaving schedules via Back to a chat place.
        shell.setSchedulesOpen(false);
      }
      applyPlace(urlPlace);
    }
    if (urlPlace.type !== 'agent' && placeOwnsHistoryAgentSearch(urlPlace)) {
      applyHistoryAgentSearch(readHistoryAgentSearch(location.search));
    } else if (!placeOwnsHistoryAgentSearch(urlPlace)) {
      applyHistoryAgentSearch(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  return null;
}
