'use client';

import { useAuiState } from '@assistant-ui/react';
import { useTrueFoundryApprovals, useTrueFoundryToolResponses } from '@truefoundry/assistant-ui-runtime';

import { useOptionalCustomActionRenderers } from '../server/CustomActionRenderersContext.js';

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

export type ComposerPauseView =
  | { kind: 'mcp' }
  | { kind: 'custom'; toolName: string }
  | { kind: 'ask-user' }
  | { kind: 'approval' }
  | { kind: 'compose' };

/** Shared composer pause detection for default and custom composer containers. */
export function useComposerPauseView(): ComposerPauseView {
  const mcpPending = useAuiState(threadHasPendingMcpAuth);
  const { pending: toolResponsesPending } = useTrueFoundryToolResponses();
  const { pending: approvalsPending } = useTrueFoundryApprovals();
  const customActionRenderers = useOptionalCustomActionRenderers();

  if (mcpPending) {
    return { kind: 'mcp' };
  }

  const firstPending = toolResponsesPending[0];
  if (firstPending != null) {
    const toolName = firstPending.toolName;
    if (toolName != null && customActionRenderers?.[toolName] != null) {
      return { kind: 'custom', toolName };
    }
    return { kind: 'ask-user' };
  }

  if (approvalsPending.length > 0) {
    return { kind: 'approval' };
  }

  return { kind: 'compose' };
}
