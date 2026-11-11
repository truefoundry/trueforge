'use client';

import { useThreadIsRunning } from '@assistant-ui/core/react';
import { useEffect, useRef } from 'react';

import { useAui, useAuiState } from '../assistant-ui.js';
import { readThreadLastTurnStatus, threadCustomWithLastTurnStatus } from '../atoms/lib/threadListMeta.js';
import { useOptionalServer } from '../server/ServerContext.js';

/**
 * Keep Chat History `lastTurnStatus` in sync with the live main thread.
 * List polling only runs while a row is already non-terminal, so a fresh send
 * from a done/idle row would never re-check without this optimistic stamp +
 * post-turn getSession refresh.
 */
export function useSyncThreadListLastTurnStatus(): void {
  const server = useOptionalServer();
  const aui = useAui();
  const remoteId = useAuiState(s => s.threadListItem.remoteId);
  const isRunning = useThreadIsRunning();
  const wasRunningRef = useRef(false);

  useEffect(() => {
    if (!isRunning || remoteId == null) return;
    const custom = aui.threadListItem().getState().custom;
    if (readThreadLastTurnStatus(custom) === 'running') return;
    void aui.threadListItem().updateCustom(threadCustomWithLastTurnStatus(custom, 'running'));
  }, [aui, isRunning, remoteId]);

  useEffect(() => {
    const finishedTurn = wasRunningRef.current && !isRunning;
    wasRunningRef.current = isRunning;

    if (!finishedTurn || server == null || remoteId == null) {
      return;
    }

    let cancelled = false;
    void server
      .getSession({ sessionId: remoteId })
      .then(session => {
        if (cancelled) return;
        const nextStatus = session.lastTurnDetails?.state.status ?? null;
        const custom = aui.threadListItem().getState().custom;
        if (readThreadLastTurnStatus(custom) === nextStatus) return;
        return aui.threadListItem().updateCustom(threadCustomWithLastTurnStatus(custom, nextStatus));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [aui, isRunning, remoteId, server]);
}
