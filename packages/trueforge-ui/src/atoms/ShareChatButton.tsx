'use client';

import { useAuiState } from '../assistant-ui.js';
import { Icon } from '../icons/Icon.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { Button } from './primitives/Button.js';

export function ShareChatButton() {
  const sessionId = useAuiState(state => state.threadListItem.remoteId);
  const ShareSessionDialog = useSlot('ShareSessionDialog');

  if (sessionId == null) return null;

  return (
    <ShareSessionDialog
      sessionId={sessionId}
      trigger={
        <Button.Ghost type="button" title="Share">
          <Icon name="share" />
          Share
        </Button.Ghost>
      }
    />
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ShareChatButton: typeof ShareChatButton;
  }
}
