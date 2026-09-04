'use client';

import { useTrueFoundryAgentSpec } from '@truefoundry/assistant-ui-runtime';

import { useAuiState } from '../assistant-ui.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { isNewChatView } from '../utils/isNewChatView.js';

export type NamedAgentHeaderState = {
  name: string;
  isEditing: boolean;
  /** New Chat vs New Agent / named-agent differentiation. */
  icon: 'square-pen' | 'agent-2';
  /** When true, prefer a non-empty thread/session title over `name`. */
  allowThreadTitle: boolean;
};

// Canonical named-agent / draft header state, including mutable edit mode.
export function useNamedAgentHeaderState(): NamedAgentHeaderState | null {
  const shell = useOptionalShellMode();
  if (shell == null || shell.mode.status !== 'active') return null;

  const identity = shell.mode.agentName ?? shell.mode.agentId;
  if (identity != null && identity.length > 0) {
    return {
      name: identity,
      isEditing: shell.mode.isMutable,
      icon: 'agent-2',
      allowThreadTitle: false,
    };
  }

  if (!shell.mode.isMutable) return null;

  const isCreateAgent = shell.mode.isCreateAgent;
  return {
    name: isCreateAgent ? 'New Agent' : 'New Chat',
    isEditing: false,
    icon: isCreateAgent ? 'agent-2' : 'square-pen',
    allowThreadTitle: true,
  };
}

export function useNamedAgentHeaderVisible(): boolean {
  const state = useNamedAgentHeaderState();
  return state !== null;
}

// Mutable New Agent / Edit with a selected model — drives Save Agent + header chrome.
export function useSaveAgentVisible(): boolean {
  const shell = useOptionalShellMode();
  const { agentSpec } = useTrueFoundryAgentSpec();
  if (shell == null || shell.mode.status !== 'active' || !shell.mode.isMutable || !shell.mode.isCreateAgent) {
    return false;
  }
  return Boolean(agentSpec?.model?.name?.trim());
}

// Clear chat: any active session (Try Agent, New Chat, New Agent, Edit) that has
// something to clear. A fresh thread has nothing, so the control stays hidden.
export function useChatChromeActionsVisible(): boolean {
  const shell = useOptionalShellMode();
  const isFresh = useAuiState(isNewChatView);
  return shell != null && shell.mode.status === 'active' && !isFresh;
}

// True when the thread header has anything to show (title, Save, and/or Clear).
// Clear alone matters for orphaned immutable history (deleted agent, no name).
export function useChatHeaderContentVisible(): boolean {
  const namedVisible = useNamedAgentHeaderVisible();
  const saveVisible = useSaveAgentVisible();
  const clearVisible = useChatChromeActionsVisible();
  return namedVisible || saveVisible || clearVisible;
}
