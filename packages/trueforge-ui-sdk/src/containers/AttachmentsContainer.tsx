'use client';

import { ComposerPrimitive, MessagePrimitive, useAui, useAuiState } from '@assistant-ui/react';

import { USER_MESSAGE_ATTACHMENT_PREVIEW_REM } from '../constants/attachments.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { isImageAttachment, useAttachmentPreviewSrc } from './useAttachmentPreviewSrc.js';

function ComposerAttachmentItem() {
  const AttachmentPreviewDialog = useSlot('AttachmentPreviewDialog');
  const AttachmentCard = useSlot('AttachmentCard');
  const aui = useAui();
  const name = useAuiState(s => s.attachment.name);
  const contentType = useAuiState(s => s.attachment.contentType);
  const type = useAuiState(s => s.attachment.type);
  const isImage = isImageAttachment(type, contentType);
  const previewSrc = useAttachmentPreviewSrc();

  return (
    <AttachmentPreviewDialog previewSrc={previewSrc}>
      <AttachmentCard
        name={name}
        contentType={contentType}
        previewSrc={previewSrc}
        isImage={isImage}
        size="chip"
        onRemove={() => void aui.attachment().remove()}
      />
    </AttachmentPreviewDialog>
  );
}

function MessageAttachmentItem() {
  const AttachmentPreviewDialog = useSlot('AttachmentPreviewDialog');
  const AttachmentCard = useSlot('AttachmentCard');
  const name = useAuiState(s => s.attachment.name);
  const contentType = useAuiState(s => s.attachment.contentType);
  const type = useAuiState(s => s.attachment.type);
  const isImage = isImageAttachment(type, contentType);
  const previewSrc = useAttachmentPreviewSrc();

  const card = (
    <AttachmentCard
      name={name}
      contentType={contentType}
      previewSrc={previewSrc}
      isImage={isImage}
      size={isImage ? 'preview' : 'chip'}
      previewRem={USER_MESSAGE_ATTACHMENT_PREVIEW_REM}
    />
  );

  if (isImage && previewSrc) {
    return <AttachmentPreviewDialog previewSrc={previewSrc}>{card}</AttachmentPreviewDialog>;
  }

  return card;
}

export function ComposerAttachmentsContainer() {
  return (
    <div className="aui-composer-attachments flex w-full flex-row flex-wrap items-center gap-2 empty:hidden">
      <ComposerPrimitive.Attachments>{() => <ComposerAttachmentItem />}</ComposerPrimitive.Attachments>
    </div>
  );
}

export function MessageAttachmentsContainer() {
  return (
    <div className="aui-user-message-attachments-end col-span-full col-start-1 row-start-1 flex w-full flex-row justify-end gap-2">
      <MessagePrimitive.Attachments>{() => <MessageAttachmentItem />}</MessagePrimitive.Attachments>
    </div>
  );
}

export function ComposerAttachmentPickerContainer() {
  const AttachmentPickerButton = useSlot('AttachmentPickerButton');
  return (
    <ComposerPrimitive.AddAttachment asChild>
      <AttachmentPickerButton />
    </ComposerPrimitive.AddAttachment>
  );
}
