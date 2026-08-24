'use client';

import { useTrueFoundryAgentSpec } from '@truefoundry/assistant-ui-runtime';

import { useAuiState } from '../assistant-ui.js';
import { useOptionalServer } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';

export type NamedAgentHeaderState = {
  name: string;
  isEditing: boolean;
};

// Canonical named-agent header state, including mutable edit mode.
export function useNamedAgentHeaderState(): NamedAgentHeaderState | null {
  const shell = useOptionalShellMode();
  if (shell == null || shell.mode.status !== 'active') return null;
  const name = shell.mode.agentName ?? shell.mode.agentId;
  if (name == null || name.length === 0) return null;
  return { name, isEditing: shell.mode.isMutable };
}

export function useNamedAgentHeaderVisible(): boolean {
  const state = useNamedAgentHeaderState();
  return state !== null;
}

// Mutable draft/edit with a selected model — drives Save Agent + header chrome.
export function useSaveAgentVisible(): boolean {
  const shell = useOptionalShellMode();
  const { agentSpec } = useTrueFoundryAgentSpec();
  if (shell == null || shell.mode.status !== 'active' || !shell.mode.isMutable) return false;
  return Boolean(agentSpec?.model?.name?.trim());
}

// Keep the actions menu beside Save Agent instead of dropping it in composer mode.
export function useChatChromeActionsVisible(): boolean {
  const shell = useOptionalShellMode();
  return shell != null && shell.mode.status === 'active';
}

export type DeleteChatState = {
  visible: boolean;
  enabled: boolean;
};

export function useDeleteChatState(): DeleteChatState {
  const server = useOptionalServer();
  const shell = useOptionalShellMode();
  const remoteId = useAuiState(s => s.threadListItem.remoteId);
  const visible = shell != null && shell.mode.status === 'active' && typeof server?.deleteSession === 'function';
  return { visible, enabled: visible && remoteId != null };
}

// Sidebar desktop chrome uses this aggregate to avoid hiding a header with usable actions.
export function useChatHeaderContentVisible(): boolean {
  const namedVisible = useNamedAgentHeaderVisible();
  const saveVisible = useSaveAgentVisible();
  const clearVisible = useChatChromeActionsVisible();
  const deleteState = useDeleteChatState();
  return namedVisible || saveVisible || clearVisible || deleteState.visible;
}
