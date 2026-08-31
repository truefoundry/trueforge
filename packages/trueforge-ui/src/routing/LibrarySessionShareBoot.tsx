'use client';

import { useEffect } from 'react';

import { useShellMode } from '../server/ShellModeContext.js';
import { readSessionShareSearch } from '../utils/sessionShareUrl.js';

/** When the URL names an agent (`?agentId=`), open it — with or without `withRouter`. */
export function LibrarySessionShareBoot() {
  const { openLibraryAgent } = useShellMode();

  useEffect(() => {
    const { agentId } = readSessionShareSearch(window.location.search);
    if (agentId == null) return;
    openLibraryAgent(agentId);
  }, [openLibraryAgent]);

  return null;
}
