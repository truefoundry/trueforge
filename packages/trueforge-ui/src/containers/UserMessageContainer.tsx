'use client';

import { useActionBarCopy, useActionBarEdit, useThreadIsRunning } from '@assistant-ui/core/react';
import { MessagePrimitive, useAui, useAuiState } from '@assistant-ui/react';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import { withSessionProps } from '../analytics/sessionProps.js';
import { useActiveSessionCanManage } from '../hooks/useResourcePermissions.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { MessageAttachmentsContainer } from './AttachmentsContainer.js';

export function UserMessageContainer() {
  const UserMessageBubble = useSlot('UserMessageBubble');
  const UserMessageActionBar = useSlot('UserMessageActionBar');
  const isRunning = useThreadIsRunning();
  const canManageSession = useActiveSessionCanManage();
  const aui = useAui();
  const track = useTrackAnalytics();
  const shell = useOptionalShellMode();
  const createdAt = useAuiState(s => s.message.createdAt);
  const sessionId = useAuiState(s => s.threadListItem.remoteId);
  const text = useAuiState(s =>
    s.message.content
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map(part => part.text)
      .join('\n'),
  );
  const { edit, disabled: editDisabled } = useActionBarEdit();
  const { copy, isCopied } = useActionBarCopy({
    copyToClipboard: value => navigator.clipboard.writeText(value),
  });
  const shellAgent =
    shell?.mode.status === 'active' ? { agentId: shell.mode.agentId, agentName: shell.mode.agentName } : {};
  const sessionProps = { sessionId, ...shellAgent };

  return (
    <MessagePrimitive.Root data-role="user">
      <UserMessageBubble
        text={text}
        attachments={<MessageAttachmentsContainer />}
        editAction={
          !isRunning ? (
            <UserMessageActionBar
              isCopied={isCopied}
              editDisabled={editDisabled || !canManageSession}
              retryDisabled={!canManageSession}
              createdAt={createdAt}
              onCopy={() => {
                track(AnalyticsEvents.Message.COPIED, withSessionProps({ role: 'user' }, sessionProps));
                copy();
              }}
              onEdit={() => {
                track(AnalyticsEvents.Message.EDIT_STARTED, withSessionProps(undefined, sessionProps));
                edit();
              }}
              onRetry={() => {
                if (!canManageSession) return;
                track(AnalyticsEvents.Message.RETRIED, withSessionProps(undefined, sessionProps));
                aui.message().composer().beginEdit();
                aui.message().composer().send({ startRun: true });
              }}
            />
          ) : undefined
        }
      />
    </MessagePrimitive.Root>
  );
}
