'use client';

import { Icon } from '../icons/Icon.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { auiButtonClass } from './lib/buttonClasses.js';

/** Resets the current named or draft chat. Hidden while the shell is idle. */
export function ClearChatButton() {
  const shell = useOptionalShellMode();

  if (shell == null || shell.mode.status === 'idle') return null;

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
