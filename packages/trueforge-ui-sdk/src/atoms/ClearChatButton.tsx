'use client';

import { Icon } from '../icons/Icon.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { auiButtonClass } from './lib/buttonClasses.js';

/** Resets the current named or draft chat. Hidden while the shell is idle. */
export function ClearChatButton() {
  const shell = useOptionalShellMode();

  if (shell == null || shell.mode.type === 'idle') return null;

  return (
    <button
      type="button"
      aria-label="Clear chat"
      title="Clear chat"
      className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
      onClick={() => shell.clearChat()}
    >
      <Icon name="rotate-right" />
    </button>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ClearChatButton: typeof ClearChatButton;
  }
}
