'use client';

import { useEffect } from 'react';

import { useAui, useAuiState } from '../assistant-ui.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';

/** Switches history sessions in place to preserve mounted chat state to prevent flickering */
export function HistorySessionSwitchBridge() {
  const shell = useOptionalShellMode();
  const aui = useAui();
  const pendingSessionId = shell?.pendingSessionId;
  const pendingSessionEpoch = shell?.pendingSessionEpoch ?? 0;
  const activeRemoteId = useAuiState(s => s.threadListItem.remoteId);

  useEffect(() => {
    if (pendingSessionId == null || shell?.sessionAccessError != null) return;
    // Row clicks already switch by local id; skip a second remote-id fetch when painted.
    if (activeRemoteId === pendingSessionId) return;
    void Promise.resolve(aui.threads().switchToThread(pendingSessionId)).catch(() => undefined);
  }, [aui, activeRemoteId, pendingSessionId, pendingSessionEpoch, shell?.sessionAccessError]);

  return null;
}
