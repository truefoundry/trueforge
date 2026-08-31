'use client';

import { useEffect } from 'react';

import { useShellMode } from '../server/ShellModeContext.js';
import { readSessionShareSearch } from '../utils/sessionShareUrl.js';

/** Open the sessions browser or a library agent from the share query — with or without `withRouter`. */
export function LibrarySessionShareBoot() {
  const { openLibraryAgent, setSessionsOpen } = useShellMode();

  useEffect(() => {
    const share = readSessionShareSearch(window.location.search);
    if (share.view === 'sessions') {
      setSessionsOpen(true);
      return;
    }
    if (share.agentId == null) return;
    openLibraryAgent(share.agentId);
  }, [openLibraryAgent, setSessionsOpen]);

  return null;
}
