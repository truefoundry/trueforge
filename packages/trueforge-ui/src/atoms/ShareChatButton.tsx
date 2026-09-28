'use client';

import { useAuiState } from '../assistant-ui.js';
import { useActiveSessionCanManage } from '../hooks/useResourcePermissions.js';
import { Icon } from '../icons/Icon.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { Button } from './primitives/Button.js';

export function ShareChatButton() {
  const sessionId = useAuiState(state => state.threadListItem.remoteId);
  const canManageSession = useActiveSessionCanManage();
  const ShareSessionDialog = useSlot('ShareSessionDialog');
  const PermissionGuard = useSlot('PermissionGuard');

  if (sessionId == null) return null;

  const trigger = (
    <Button.Ghost type="button" title="Share">
      <Icon name="share" />
      Share
    </Button.Ghost>
  );

  if (!canManageSession) {
    return <PermissionGuard allowed={false}>{trigger}</PermissionGuard>;
  }

  return <ShareSessionDialog sessionId={sessionId} trigger={trigger} />;
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ShareChatButton: typeof ShareChatButton;
  }
}
