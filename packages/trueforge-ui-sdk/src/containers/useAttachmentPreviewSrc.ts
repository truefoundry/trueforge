'use client';

import { useAuiState } from '@assistant-ui/react';
import { useEffect, useState } from 'react';

export function isImageAttachment(type: string, contentType?: string): boolean {
  return type === 'image' || (contentType?.startsWith('image/') ?? false);
}

function useFileObjectUrl(file: File | undefined): string | undefined {
  const [src, setSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!file) {
      setSrc(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setSrc(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return src;
}

/** Preview URL for staged composer files (object URL) or sent message attachments (data URI). */
export function useAttachmentPreviewSrc(): string | undefined {
  const type = useAuiState(s => s.attachment.type);
  const contentType = useAuiState(s => s.attachment.contentType);
  const file = useAuiState(s => ('file' in s.attachment ? s.attachment.file : undefined));
  const contentSrc = useAuiState(s => {
    if (!isImageAttachment(s.attachment.type, s.attachment.contentType)) return undefined;
    const imagePart = s.attachment.content?.find(part => part.type === 'image');
    if (imagePart?.type === 'image' && imagePart.image) return imagePart.image;
    return undefined;
  });

  const image = isImageAttachment(type, contentType);
  const fileSrc = useFileObjectUrl(image ? file : undefined);
  if (!image) return undefined;
  return fileSrc ?? contentSrc;
}
