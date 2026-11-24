'use client';

import { useThreadIsRunning } from '@assistant-ui/core/react';
import { useEffect, useRef } from 'react';

import { useAui, useAuiState } from '../assistant-ui.js';
import { useServerQueryClient } from '../server/queryClient.js';
import { invalidateSessionLists } from '../server/sessionQueries.js';

/**
 * The server writes the session title when the first turn is created, before the
 * model replies. assistant-ui skips its own trigger because we initialize the
 * session first, so refresh the blank sidebar row when the user message id
 * changes to the server turn id. If that id never changes, refresh when the turn ends.
 */
export function useSyncSessionTitle(): void {
  const aui = useAui();
  const queryClient = useServerQueryClient();
  const remoteId = useAuiState(s => s.threadListItem.remoteId);
  const title = useAuiState(s => s.threadListItem.title);
  const firstUserMessageId = useAuiState(s => s.thread.messages.find(message => message.role === 'user')?.id);
  const isRunning = useThreadIsRunning();
  const wasRunningRef = useRef(false);
  const prevRemoteIdRef = useRef(remoteId);
  const seenUserMessageIdRef = useRef(firstUserMessageId);
  const attemptedRemoteIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    // Leaving a running thread for an idle one flips `isRunning` without that session finishing a turn.
    const switchedSession = prevRemoteIdRef.current !== remoteId;
    prevRemoteIdRef.current = remoteId;
    const finishedTurn = !switchedSession && wasRunningRef.current && !isRunning;
    wasRunningRef.current = isRunning;
    // The optimistic user message uses a client turn id. It changes once
    // `turn.created` arrives, which is after the title write has committed.
    const previousUserMessageId = seenUserMessageIdRef.current;
    seenUserMessageIdRef.current = firstUserMessageId;
    const turnAccepted =
      !switchedSession &&
      isRunning &&
      previousUserMessageId != null &&
      firstUserMessageId != null &&
      previousUserMessageId !== firstUserMessageId;
    if (switchedSession) {
      attemptedRemoteIdRef.current = undefined;
    }

    // The server only derives a title on the first turn, so one attempt per session is enough.
    if ((!turnAccepted && !finishedTurn) || remoteId == null || attemptedRemoteIdRef.current === remoteId) {
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
      .then(() => invalidateSessionLists(queryClient))
      .catch(() => undefined);
  }, [aui, firstUserMessageId, isRunning, queryClient, remoteId, title]);
}
