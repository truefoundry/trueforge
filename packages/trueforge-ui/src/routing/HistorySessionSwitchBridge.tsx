'use client';

import { useEffect } from 'react';

import { useAui } from '../assistant-ui.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';

/** Switches history sessions in place to preserve mounted chat state to prevent flickering */
export function HistorySessionSwitchBridge() {
  const shell = useOptionalShellMode();
  const aui = useAui();
  const pendingSessionId = shell?.pendingSessionId;
  const pendingSessionEpoch = shell?.pendingSessionEpoch ?? 0;

  useEffect(() => {
    if (pendingSessionId == null) return;
    void Promise.resolve(aui.threads().switchToThread(pendingSessionId)).catch(() => undefined);
  }, [aui, pendingSessionId, pendingSessionEpoch]);

  return null;
}
