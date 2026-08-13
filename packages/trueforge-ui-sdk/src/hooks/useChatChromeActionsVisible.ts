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

// Mutable draft/edit with a selected model — drives Save Agent + header chrome.
export function useSaveAgentVisible(): boolean {
  const shell = useOptionalShellMode();
  const { agentSpec } = useTrueFoundryAgentSpec();
  if (shell == null || shell.mode.status !== 'active' || !shell.mode.isMutable) return false;
  return Boolean(agentSpec?.model?.name?.trim());
}

// Clear chat: after a chat has started (drafts need a model).
// Named / saved agents keep Clear visible even on an empty welcome thread.
export function useChatChromeActionsVisible(): boolean {
  const shell = useOptionalShellMode();
  const { agentSpec } = useTrueFoundryAgentSpec();
  const isEmpty = useAuiState(isNewChatView);

  if (shell == null || shell.mode.status !== 'active') return false;
  if (shell.mode.isMutable && !agentSpec?.model?.name?.trim()) return false;
  if (isEmpty) {
    const boundName = shell.mode.agentName ?? shell.mode.agentId;
    const isNamedOrSaved = boundName != null && boundName.length > 0;
    if (!isNamedOrSaved) return false;
  }
  return true;
}

// True when the thread header has anything to show (title, Save, and/or Clear).
// Clear alone matters for orphaned immutable history (deleted agent, no name).
export function useChatHeaderContentVisible(): boolean {
  const namedVisible = useNamedAgentHeaderVisible();
  const saveVisible = useSaveAgentVisible();
  const clearVisible = useChatChromeActionsVisible();
  return namedVisible || saveVisible || clearVisible;
}
