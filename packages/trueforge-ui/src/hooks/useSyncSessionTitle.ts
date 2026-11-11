'use client';

import { useThreadIsRunning } from '@assistant-ui/core/react';
import { useEffect, useRef } from 'react';

import { useAui, useAuiState } from '../assistant-ui.js';

/**
 * After a turn ends, refresh an untitled thread-list row via `generateTitle`,
 * which reads the server-written title without a rename PATCH. assistant-ui's
 * built-in trigger skips our threads because the runtime initializes the
 * session itself before the first message.
 */
export function useSyncSessionTitle(): void {
  const aui = useAui();
  const remoteId = useAuiState(s => s.threadListItem.remoteId);
  const title = useAuiState(s => s.threadListItem.title);
  const isRunning = useThreadIsRunning();
  const wasRunningRef = useRef(false);
  const prevRemoteIdRef = useRef(remoteId);
  const attemptedRemoteIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    // Leaving a running thread for an idle one flips `isRunning` without that session finishing a turn.
    const switchedSession = prevRemoteIdRef.current !== remoteId;
    prevRemoteIdRef.current = remoteId;
    const finishedTurn = !switchedSession && wasRunningRef.current && !isRunning;
    wasRunningRef.current = isRunning;
    if (switchedSession) {
      attemptedRemoteIdRef.current = undefined;
    }

    // The server only derives a title on the first turn, so one attempt per session is enough.
    if (!finishedTurn || remoteId == null || attemptedRemoteIdRef.current === remoteId) {
      return;
    }
    // History rows already carry a title; only fill blank / "new" local rows.
    if (title != null && title.trim() !== '') {
      return;
    }
    attemptedRemoteIdRef.current = remoteId;

    // Bind now so the deferred call targets the row that just finished, not whichever is active later.
    const item = aui.threadListItem();
    // The scope types `generateTitle` as void, but the runtime returns a promise;
    // chaining through `then` adopts it so a rejection is still swallowed.
    void Promise.resolve()
      .then(() => item.generateTitle())
      .catch(() => undefined);
  }, [aui, isRunning, remoteId, title]);
}
