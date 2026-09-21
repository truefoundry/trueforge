'use client';

import { useEffect } from 'react';

import { useOptionalAgentSessionsServer } from '../server/ServerContext.js';
import { useShellMode } from '../server/ShellModeContext.js';
import { isSessionsChromeEnabled } from '../server/serverChrome.js';
import { readSessionShareSearch } from '../utils/sessionShareUrl.js';
import { useOptionalShellLocationStore } from './ShellLocationContext.js';

/**
 * Open the sessions browser or a library agent from the share query.
 * With `withRouter`, the real URL keeps the share params.
 * Without it, share params are already consumed into sessionStorage at store
 * creation — this only applies shell overlays when the host URL still carries them
 * (e.g. tests that set search after mount).
 */
export function LibrarySessionShareBoot() {
  const { openLibraryAgent, setSessionsOpen } = useShellMode();
  const sessions = useOptionalAgentSessionsServer();
  const sessionsEnabled = isSessionsChromeEnabled({ sessions });
  const locationStore = useOptionalShellLocationStore();

  useEffect(() => {
    if (!sessionsEnabled) return;
    // Storage mode: share links are applied when the location store is created
    // (pathname + search seeded, window stripped). ShellStorageRouteSync boots from that.
    if (locationStore != null) return;
    const share = readSessionShareSearch(window.location.search);
    if (share.view === 'sessions') {
      setSessionsOpen(true);
      return;
    }
    if (share.agentId == null) return;
    openLibraryAgent(share.agentId);
  }, [locationStore, openLibraryAgent, sessionsEnabled, setSessionsOpen]);

  return null;
}
