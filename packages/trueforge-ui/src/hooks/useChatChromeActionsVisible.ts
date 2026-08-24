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

// Preserve the existing Clear Chat visibility for immutable (named/saved) sessions.
export function useChatChromeActionsVisible(): boolean {
  const shell = useOptionalShellMode();
  return shell != null && shell.mode.status === 'active' && !shell.mode.isMutable;
}

export function useDeleteChatVisible(): boolean {
  const server = useOptionalServer();
  const shell = useOptionalShellMode();
  const remoteId = useAuiState(s => s.threadListItem.remoteId);
  return (
    shell != null && shell.mode.status === 'active' && remoteId != null && typeof server?.deleteSession === 'function'
  );
}

// Sidebar desktop chrome uses this aggregate to avoid hiding a header with usable actions.
export function useChatHeaderContentVisible(): boolean {
  const namedVisible = useNamedAgentHeaderVisible();
  const saveVisible = useSaveAgentVisible();
  const clearVisible = useChatChromeActionsVisible();
  const deleteVisible = useDeleteChatVisible();
  return namedVisible || saveVisible || clearVisible || deleteVisible;
}
