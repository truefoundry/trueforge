'use client';

import { useAuiState } from '@assistant-ui/react';
import { useTrueFoundryAgentSpec } from '@truefoundry/assistant-ui-runtime';

import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { isNewChatView } from '../utils/isNewChatView.js';

// Immutable named-agent title in the thread header.
export function useNamedAgentHeaderVisible(): boolean {
  const shell = useOptionalShellMode();
  if (shell == null || shell.mode.status !== 'active' || shell.mode.isMutable) return false;
  const name = shell.mode.agentName ?? shell.mode.agentId;
  return name != null && name.length > 0;
}

// Show Clear/Save after chat starts; drafts require a model.
// Keep actions for Library Edit even when thread is empty.
export function useChatChromeActionsVisible(): boolean {
  const shell = useOptionalShellMode();
  const { agentSpec } = useTrueFoundryAgentSpec();
  const isEmpty = useAuiState(isNewChatView);

  if (shell == null || shell.mode.status !== 'active') return false;
  if (shell.mode.isMutable && !agentSpec?.model?.name?.trim()) return false;
  if (isEmpty) {
    const boundName = shell.mode.agentName ?? shell.mode.agentId;
    const isBoundMutableEdit = shell.mode.isMutable && boundName != null && boundName.length > 0;
    if (!isBoundMutableEdit) return false;
  }
  return true;
}

// True when the thread header has a title and/or Clear/Save actions.
export function useChatHeaderContentVisible(): boolean {
  const namedVisible = useNamedAgentHeaderVisible();
  const actionsVisible = useChatChromeActionsVisible();
  return namedVisible || actionsVisible;
}
