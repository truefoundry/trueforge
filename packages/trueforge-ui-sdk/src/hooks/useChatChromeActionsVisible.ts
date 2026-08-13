'use client';

import { useTrueFoundryAgentSpec } from '@truefoundry/assistant-ui-runtime';

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

// Clear chat: only on immutable (named / saved) sessions — same gate as the agent title.
export function useChatChromeActionsVisible(): boolean {
  const shell = useOptionalShellMode();
  return shell != null && shell.mode.status === 'active' && !shell.mode.isMutable;
}

// True when the thread header has anything to show (title, Save, and/or Clear).
// Clear alone matters for orphaned immutable history (deleted agent, no name).
export function useChatHeaderContentVisible(): boolean {
  const namedVisible = useNamedAgentHeaderVisible();
  const saveVisible = useSaveAgentVisible();
  const clearVisible = useChatChromeActionsVisible();
  return namedVisible || saveVisible || clearVisible;
}
