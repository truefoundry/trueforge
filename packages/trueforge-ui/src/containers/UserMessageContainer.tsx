'use client';

import { useActionBarCopy, useActionBarEdit, useThreadIsRunning } from '@assistant-ui/core/react';
import { MessagePrimitive, useAui, useAuiState } from '@assistant-ui/react';

import { useSlot } from '../theme/SlotsProvider.js';
import { MessageAttachmentsContainer } from './AttachmentsContainer.js';

export function UserMessageContainer() {
  const UserMessageBubble = useSlot('UserMessageBubble');
  const UserMessageActionBar = useSlot('UserMessageActionBar');
  const isRunning = useThreadIsRunning();
  const aui = useAui();
  const createdAt = useAuiState(s => s.message.createdAt);
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

  return (
    <MessagePrimitive.Root data-role="user">
      <UserMessageBubble
        text={text}
        attachments={<MessageAttachmentsContainer />}
        editAction={
          !isRunning ? (
            <UserMessageActionBar
              isCopied={isCopied}
              editDisabled={editDisabled}
              createdAt={createdAt}
              onCopy={copy}
              onEdit={edit}
              onRetry={() => {
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
