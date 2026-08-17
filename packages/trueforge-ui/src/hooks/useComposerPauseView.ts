'use client';

import { useAuiState } from '@assistant-ui/react';
import { useTrueFoundryToolResponses } from '@truefoundry/assistant-ui-runtime';

export type ThreadPauseState = {
  thread: {
    messages: readonly {
      role: string;
      status?: { type: string };
      metadata?: { custom?: unknown };
    }[];
  };
};

/** Returns true when the latest assistant message is paused for MCP authorization. */
export function threadHasPendingMcpAuth(s: ThreadPauseState): boolean {
  const messages = s.thread.messages;
  const last = messages[messages.length - 1];
  if (last?.role !== 'assistant') return false;
  if (last.status?.type !== 'requires-action') return false;
  return (last.metadata?.custom as { pendingMcpAuth?: boolean } | undefined)?.pendingMcpAuth === true;
}

export type ComposerPauseView = { kind: 'mcp' } | { kind: 'ask-user' } | { kind: 'compose' };

/** Shared composer pause detection for default and custom composer containers. */
export function useComposerPauseView(): ComposerPauseView {
  const mcpPending = useAuiState(threadHasPendingMcpAuth);
  const { pending: toolResponsesPending } = useTrueFoundryToolResponses();

  if (mcpPending) {
    return { kind: 'mcp' };
  }
  if (toolResponsesPending.length > 0) {
    return { kind: 'ask-user' };
  }
  return { kind: 'compose' };
}
