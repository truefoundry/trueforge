'use client';

import { useTrueForgeAgentSpec } from '@truefoundry/trueforge-assistant-ui-runtime';

import { useChatChromeActionsVisible } from '../hooks/useChatChromeActionsVisible.js';
import { useActiveSessionCanManage } from '../hooks/useResourcePermissions.js';
import { Icon } from '../icons/Icon.js';
import { shellIsCreateAgent, useOptionalShellMode } from '../server/ShellModeContext.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { auiButtonClass } from './lib/buttonClasses.js';

// Starts a fresh chat / draft (Try Agent, New Chat, New Agent, Edit).
// Hidden while idle and on a fresh chat.
export function ClearChatButton() {
  const shell = useOptionalShellMode();
  const { agentSpec } = useTrueForgeAgentSpec();
  const visible = useChatChromeActionsVisible();
  const canManageSession = useActiveSessionCanManage();
  const PermissionGuard = useSlot('PermissionGuard');

  if (!visible || shell == null) return null;

  return (
    <PermissionGuard allowed={canManageSession}>
      <button
        type="button"
        title="New Chat"
        className={auiButtonClass({ variant: 'ghost', size: 'large' })}
        onClick={() => {
          if (!canManageSession) return;
          shell.clearChat(shellIsCreateAgent(shell.mode) ? (agentSpec ?? undefined) : undefined);
        }}
      >
        <Icon name="square-pen" size="0.875rem" />
        New Chat
      </button>
    </PermissionGuard>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ClearChatButton: typeof ClearChatButton;
  }
}
