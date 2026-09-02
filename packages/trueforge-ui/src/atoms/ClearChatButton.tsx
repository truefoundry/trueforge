'use client';

import { useChatChromeActionsVisible } from '../hooks/useChatChromeActionsVisible.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { Button } from './primitives/Button.js';

// Resets an immutable (named) chat. Hidden while idle or on mutable drafts.
export function ClearChatButton() {
  const shell = useOptionalShellMode();
  const visible = useChatChromeActionsVisible();

  if (!visible || shell == null) return null;

  return (
    <Button.Ghost type="button" title="Clear chat" size="small" onClick={() => shell.clearChat()}>
      <Icon name="broom" size="0.875rem" />
      Clear chat
    </Button.Ghost>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ClearChatButton: typeof ClearChatButton;
  }
}
