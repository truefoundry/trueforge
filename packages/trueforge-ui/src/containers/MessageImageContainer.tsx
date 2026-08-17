'use client';

import { useAuiState } from '@assistant-ui/react';

import { USER_MESSAGE_ATTACHMENT_PREVIEW_REM } from '../constants/attachments.js';
import { useSlot } from '../theme/SlotsProvider.js';

export function MessageImageContainer() {
  const AttachmentCard = useSlot('AttachmentCard');
  const AttachmentPreviewDialog = useSlot('AttachmentPreviewDialog');
  const image = useAuiState(s => (s.part.type === 'image' ? s.part.image : ''));
  const filename = useAuiState(s => (s.part.type === 'image' ? s.part.filename : undefined));

  if (!image) {
    return null;
  }

  const card = (
    <AttachmentCard
      name={filename ?? 'image'}
      previewSrc={image}
      isImage
      size="preview"
      previewRem={USER_MESSAGE_ATTACHMENT_PREVIEW_REM}
    />
  );

  return (
    <AttachmentPreviewDialog previewSrc={image}>
      <div className="aui-message-image">{card}</div>
    </AttachmentPreviewDialog>
  );
}
