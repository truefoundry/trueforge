'use client';

import { useEffect } from 'react';

import { useOptionalAgentSessionsServer } from '../server/ServerContext.js';
import { useShellMode } from '../server/ShellModeContext.js';
import { isSessionsChromeEnabled } from '../server/serverChrome.js';
import { readSessionShareSearch } from '../utils/sessionShareUrl.js';

/** Open the sessions browser or a library agent from the share query — with or without `withRouter`. */
export function LibrarySessionShareBoot() {
  const { openLibraryAgent, setSessionsOpen } = useShellMode();
  const sessions = useOptionalAgentSessionsServer();
  const sessionsEnabled = isSessionsChromeEnabled({ sessions });

  useEffect(() => {
    if (!sessionsEnabled) return;
    const share = readSessionShareSearch(window.location.search);
    if (share.view === 'sessions') {
      setSessionsOpen(true);
      return;
    }
    if (share.agentId == null) return;
    openLibraryAgent(share.agentId);
  }, [openLibraryAgent, sessionsEnabled, setSessionsOpen]);

  return null;
}
