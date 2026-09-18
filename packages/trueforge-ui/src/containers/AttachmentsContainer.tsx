'use client';

import { ComposerPrimitive, MessagePrimitive, useAui, useAuiState } from '@assistant-ui/react';

import { USER_MESSAGE_ATTACHMENT_PREVIEW_REM } from '../constants/attachments.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { isImageAttachment, useAttachmentPreviewSrc } from './useAttachmentPreviewSrc.js';

function base64DataUriByteSize(data: string): number | undefined {
  const commaIndex = data.indexOf(',');
  if (commaIndex < 0 || !data.slice(0, commaIndex).endsWith(';base64')) return undefined;

  const payload = data.slice(commaIndex + 1).replace(/\s/g, '');
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

function useAttachmentSizeBytes(): number | undefined {
  const fileSize = useAuiState(s => ('file' in s.attachment ? s.attachment.file?.size : undefined));
  const data = useAuiState(s => {
    const filePart = s.attachment.content?.find(part => part.type === 'file');
    return filePart?.type === 'file' ? filePart.data : undefined;
  });
  return fileSize ?? (data == null ? undefined : base64DataUriByteSize(data));
}

function ComposerAttachmentItem() {
  const AttachmentPreviewDialog = useSlot('AttachmentPreviewDialog');
  const AttachmentCard = useSlot('AttachmentCard');
  const aui = useAui();
  const name = useAuiState(s => s.attachment.name);
  const contentType = useAuiState(s => s.attachment.contentType);
  const type = useAuiState(s => s.attachment.type);
  const isImage = isImageAttachment(type, contentType);
  const previewSrc = useAttachmentPreviewSrc();
  const sizeBytes = useAttachmentSizeBytes();

  return (
    <AttachmentPreviewDialog previewSrc={previewSrc}>
      <AttachmentCard
        name={name}
        contentType={contentType}
        sizeBytes={sizeBytes}
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
  const sizeBytes = useAttachmentSizeBytes();

  const card = (
    <AttachmentCard
      name={name}
      contentType={contentType}
      sizeBytes={sizeBytes}
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
    <div className="aui-composer-attachments flex w-full min-w-0 flex-row flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden empty:hidden">
      <ComposerPrimitive.Attachments>{() => <ComposerAttachmentItem />}</ComposerPrimitive.Attachments>
    </div>
  );
}

export function MessageAttachmentsContainer() {
  return (
    <div className="aui-user-message-attachments-end col-span-full col-start-1 row-start-1 flex w-full flex-row flex-wrap justify-end gap-2">
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
