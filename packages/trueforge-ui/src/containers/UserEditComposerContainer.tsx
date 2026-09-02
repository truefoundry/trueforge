'use client';

import { useComposerCancel, useComposerSend, useThreadIsRunning } from '@assistant-ui/core/react';
import { ComposerPrimitive, MessagePrimitive, useAuiState } from '@assistant-ui/react';

import { Button } from '../atoms/primitives/Button.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { MessageAttachmentsContainer } from './AttachmentsContainer.js';

function ReadOnlyMessageAttachments() {
  const hasAttachments = useAuiState(s => (s.message.attachments?.length ?? 0) > 0);
  if (!hasAttachments) {
    return null;
  }
  return (
    <div className="pointer-events-none mb-2 opacity-90">
      <MessageAttachmentsContainer />
    </div>
  );
}

export function UserEditComposerContainer() {
  const UserMessageEdit = useSlot('UserMessageEdit');
  const MessageTimestamp = useSlot('MessageTimestamp');
  const isRunning = useThreadIsRunning();
  const createdAt = useAuiState(s => s.message.createdAt);
  const { cancel, disabled: cancelDisabled } = useComposerCancel();
  const { disabled: sendDisabled } = useComposerSend();

  return (
    <MessagePrimitive.Root data-role="user">
      <ComposerPrimitive.Root
        data-slot="aui_user-edit-composer-root"
        className="fade-in slide-in-from-bottom-1 animate-in flex w-full justify-end px-2 duration-150"
      >
        <UserMessageEdit
          timestamp={<MessageTimestamp createdAt={createdAt} />}
          attachments={<ReadOnlyMessageAttachments />}
          input={
            <div className="mt-1 rounded border border-border bg-secondary-bg p-2 text-text-primary">
              <ComposerPrimitive.Input
                data-slot="aui_user-edit-input"
                disabled={isRunning}
                submitMode="enter"
                aria-label="Edit message"
                className="max-h-32 min-h-10 w-full resize-none border-none bg-transparent p-0 text-base leading-[1.34] outline-none focus:shadow-none"
              />
            </div>
          }
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button.Secondary type="button" disabled={cancelDisabled} onClick={cancel}>
                Cancel
              </Button.Secondary>
              <ComposerPrimitive.Send asChild>
                <Button.Primary type="submit" disabled={sendDisabled || isRunning}>
                  Save &amp; Rerun
                </Button.Primary>
              </ComposerPrimitive.Send>
            </div>
          }
        />
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
}
