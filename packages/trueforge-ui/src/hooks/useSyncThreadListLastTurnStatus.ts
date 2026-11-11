'use client';

import { useThreadIsRunning } from '@assistant-ui/core/react';
import { useEffect, useRef } from 'react';

import { useAui, useAuiState } from '../assistant-ui.js';
import { readThreadLastTurnStatus, threadCustomWithLastTurnStatus } from '../atoms/lib/threadListMeta.js';
import { useOptionalServer } from '../server/ServerContext.js';

/**
 * Keep Chat History `lastTurnStatus` in sync with the live main thread.
 * List polling skips the main row while the live turn is generating (and for any
 * poll that began then), so a fresh send needs this optimistic stamp; when the
 * turn ends we drop `running` immediately (so a failed getSession cannot leave
 * the row shimmering) and then refine from getSession.
 */
export function useSyncThreadListLastTurnStatus(): void {
  const server = useOptionalServer();
  const aui = useAui();
  const remoteId = useAuiState(s => s.threadListItem.remoteId);
  const isRunning = useThreadIsRunning();
  const wasRunningRef = useRef(false);
  const prevRemoteIdRef = useRef(remoteId);

  useEffect(() => {
    if (!isRunning || remoteId == null) return;
    const custom = aui.threadListItem().getState().custom;
    if (readThreadLastTurnStatus(custom) === 'running') return;
    void aui.threadListItem().updateCustom(threadCustomWithLastTurnStatus(custom, 'running'));
  }, [aui, isRunning, remoteId]);

  useEffect(() => {
    // Leaving a running thread for an idle one flips `isRunning` without that session finishing a turn.
    const switchedSession = prevRemoteIdRef.current !== remoteId;
    prevRemoteIdRef.current = remoteId;
    const finishedTurn = !switchedSession && wasRunningRef.current && !isRunning;
    wasRunningRef.current = isRunning;

    if (!finishedTurn || remoteId == null) {
      return;
    }

    // Drop the optimistic running stamp immediately so the row cannot stick on
    // shimmering dots if getSession fails; poll may also refresh once !isRunning.
    const custom = aui.threadListItem().getState().custom;
    if (readThreadLastTurnStatus(custom) === 'running') {
      void aui.threadListItem().updateCustom(threadCustomWithLastTurnStatus(custom, null));
    }

    if (server == null) return;

    let cancelled = false;
    void server
      .getSession({ sessionId: remoteId })
      .then(session => {
        if (cancelled) return;
        const nextStatus = session.lastTurnDetails?.state.status ?? null;
        const latestCustom = aui.threadListItem().getState().custom;
        if (readThreadLastTurnStatus(latestCustom) === nextStatus) return;
        return aui.threadListItem().updateCustom(threadCustomWithLastTurnStatus(latestCustom, nextStatus));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [aui, isRunning, remoteId, server]);
}
