'use client';

import { useChatChromeActionsVisible } from '../hooks/useChatChromeActionsVisible.js';
import { useActiveSessionCanManage } from '../hooks/useResourcePermissions.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { auiButtonClass } from './lib/buttonClasses.js';

// Resets the current chat / draft (Try Agent, New Chat, New Agent, Edit).
// Hidden while idle and on a fresh chat.
export function ClearChatButton() {
  const shell = useOptionalShellMode();
  const visible = useChatChromeActionsVisible();
  const canManageSession = useActiveSessionCanManage();
  const PermissionGuard = useSlot('PermissionGuard');

  if (!visible || shell == null) return null;

  return (
    <PermissionGuard allowed={canManageSession}>
      <button
        type="button"
        title="Clear chat"
        className={auiButtonClass({ variant: 'ghost', size: 'sm' })}
        onClick={() => {
          if (canManageSession) shell.clearChat();
        }}
      >
        <Icon name="broom" size="0.875rem" />
        Clear chat
      </button>
    </PermissionGuard>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ClearChatButton: typeof ClearChatButton;
  }
}
