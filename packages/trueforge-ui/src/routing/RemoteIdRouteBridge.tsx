'use client';

import { useEffect } from 'react';

import { useAuiState } from '../assistant-ui.js';

/**
 * Observes the active thread's remote id (assigned once a fresh chat persists)
 * and lifts it to the parent so `ShellRouteSync` can mirror it to `/sessions/:id`.
 * Lives inside the chat runtime, so it remounts with `runtimeKey`; reporting is
 * idempotent, so that is harmless. Carries no react-router dependency.
 */
export function RemoteIdRouteBridge({ onRemoteIdChange }: { onRemoteIdChange: (id: string | undefined) => void }) {
  const remoteId = useAuiState(s => s.threadListItem.remoteId);
  useEffect(() => {
    onRemoteIdChange(remoteId ?? undefined);
  }, [remoteId, onRemoteIdChange]);
  return null;
}
