'use client';

import { useChatChromeActionsVisible } from '../hooks/useChatChromeActionsVisible.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { auiButtonClass } from './lib/buttonClasses.js';

// Resets the current chat / draft (Try Agent, New Chat, New Agent, Edit).
// Hidden while idle and on a fresh chat.
export function ClearChatButton() {
  const shell = useOptionalShellMode();
  const visible = useChatChromeActionsVisible();

  if (!visible || shell == null) return null;

  return (
    <button
      type="button"
      title="Clear chat"
      className={auiButtonClass({ variant: 'ghost', size: 'sm' })}
      onClick={() => shell.clearChat()}
    >
      <Icon name="broom" size="0.875rem" />
      Clear chat
    </button>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ClearChatButton: typeof ClearChatButton;
  }
}
