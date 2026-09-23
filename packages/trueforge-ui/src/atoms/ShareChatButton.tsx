'use client';

import { useAuiState } from '../assistant-ui.js';
import { useCopySharedSessionLink } from '../hooks/useCopySharedSessionLink.js';
import { Icon } from '../icons/Icon.js';
import { auiButtonClass } from './lib/buttonClasses.js';

export function ShareChatButton() {
  const sessionId = useAuiState(state => state.threadListItem.remoteId);
  const { copied, copySharedSessionLink } = useCopySharedSessionLink(sessionId);

  if (sessionId == null) return null;

  return (
    <button
      type="button"
      title="Copy shared link"
      className={auiButtonClass({ variant: 'ghost', size: 'large' })}
      onClick={() => void copySharedSessionLink()}
    >
      <Icon name="link" size="0.875rem" />
      {copied ? 'Copied' : 'Share'}
    </button>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ShareChatButton: typeof ShareChatButton;
  }
}
