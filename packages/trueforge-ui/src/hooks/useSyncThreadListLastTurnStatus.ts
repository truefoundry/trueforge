'use client';

import { useThreadIsRunning } from '@assistant-ui/core/react';
import { useEffect, useRef } from 'react';

import { useAui, useAuiState } from '../assistant-ui.js';
import {
  isNewerActivityAt,
  readThreadLastActivityAt,
  readThreadLastTurnStatus,
  threadCustomWithLastTurnStatus,
} from '../atoms/lib/threadListMeta.js';
import { useServerQueryClient } from '../server/queryClient.js';
import { useOptionalServer } from '../server/ServerContext.js';
import { fetchSessionDetail, invalidateSessionLists } from '../server/sessionQueries.js';

type LiveThreadMessage = {
  role: string;
  status?: { type: string };
};

/**
 * `null` when this thread has no assistant message yet. A listed paused dot must
 * stay until the transcript loads; an empty list is not "the user already answered".
 */
function liveThreadRequiresUserAction(messages: readonly LiveThreadMessage[]): boolean | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message == null || message.role !== 'assistant') continue;
    return message.status?.type === 'requires-action';
  }
  return null;
}

/**
 * Keep Chat History `lastTurnStatus` in sync with the live main thread.
 * List polling skips the main row while the live turn is generating (and for any
 * poll that began then), so a fresh send needs this optimistic stamp; when the
 * turn ends we drop `running` immediately (so a failed getSession cannot leave
 * the row shimmering) and then refine from getSession.
 * Approving a paused turn can finish without another `running` edge, and the
 * open row is not polled, so a completed assistant message clears the paused dot
 * itself. A getSession that still says `paused` must not put that dot back.
 */
export function useSyncThreadListLastTurnStatus(): void {
  const server = useOptionalServer();
  const queryClient = useServerQueryClient();
  const aui = useAui();
  const remoteId = useAuiState(s => s.threadListItem.remoteId);
  const lastMessageAt = useAuiState(s => s.threadListItem.lastMessageAt);
  const requiresAction = useAuiState(s => liveThreadRequiresUserAction(s.thread.messages));
  const isRunning = useThreadIsRunning();
  const wasRunningRef = useRef(false);
  const prevRemoteIdRef = useRef(remoteId);
  // Read inside the finished-turn effect. A dep would rerun it after isRunning
  // flips false, cancel the in-flight getSession, and skip the paused/error stamp.
  const lastMessageAtRef = useRef(lastMessageAt);
  lastMessageAtRef.current = lastMessageAt;
  const requiresActionRef = useRef(requiresAction);
  requiresActionRef.current = requiresAction;

  useEffect(() => {
    if (isRunning || remoteId == null || requiresAction !== false) return;
    const custom = aui.threadListItem().getState().custom;
    if (readThreadLastTurnStatus(custom) !== 'paused') return;
    void aui.threadListItem().updateCustom(threadCustomWithLastTurnStatus(custom, null, new Date().toISOString()));
  }, [aui, isRunning, remoteId, requiresAction]);

  useEffect(() => {
    if (!isRunning || remoteId == null) return;
    const custom = aui.threadListItem().getState().custom;
    if (readThreadLastTurnStatus(custom) === 'running') return;
    void aui.threadListItem().updateCustom(threadCustomWithLastTurnStatus(custom, 'running', new Date().toISOString()));
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
    // A settled turn bumps `updatedAt`, so this fresh read also retires cached history and list rows.
    void invalidateSessionLists(queryClient);
    void fetchSessionDetail({ queryClient, server, sessionId: remoteId, fresh: true })
      .then(session => {
        if (cancelled) return;
        const nextStatus = session.lastTurnDetails?.state.status ?? null;
        // The pause getSession can resolve after the user already approved and the
        // stream finished. The transcript is newer than that snapshot.
        if (nextStatus === 'paused' && requiresActionRef.current === false) return;
        const latestCustom = aui.threadListItem().getState().custom;
        const statusSame = (readThreadLastTurnStatus(latestCustom) ?? null) === nextStatus;
        const prevActivity = readThreadLastActivityAt(latestCustom) ?? lastMessageAtRef.current;
        if (statusSame && !isNewerActivityAt(session.updatedAt, prevActivity)) return;
        return aui
          .threadListItem()
          .updateCustom(threadCustomWithLastTurnStatus(latestCustom, nextStatus, session.updatedAt));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [aui, isRunning, queryClient, remoteId, server]);
}
