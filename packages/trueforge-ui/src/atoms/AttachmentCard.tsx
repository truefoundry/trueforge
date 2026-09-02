'use client';

import { USER_MESSAGE_ATTACHMENT_PREVIEW_REM } from '../constants/attachments.js';
import { Icon } from '../icons/Icon.js';
import { cn } from './lib/cn.js';
import { Avatar, AvatarFallback, AvatarImage } from './primitives/Avatar.js';
import { Button } from './primitives/Button.js';

export { USER_MESSAGE_ATTACHMENT_PREVIEW_REM };

export type AttachmentCardSize = 'chip' | 'preview';

export type AttachmentCardProps = {
  name: string;
  contentType?: string;
  previewSrc?: string;
  isImage?: boolean;
  size?: AttachmentCardSize;
  /** When set, constrains image preview and file chip width to this rem size. */
  previewRem?: number;
  onRemove?: () => void;
  className?: string;
};

export function AttachmentCard({
  name,
  previewSrc,
  isImage = false,
  size = 'chip',
  previewRem,
  onRemove,
  className,
}: AttachmentCardProps) {
  if (size === 'preview' && isImage && previewSrc) {
    const previewSize = previewRem != null ? { width: `${previewRem}rem`, height: `${previewRem}rem` } : undefined;

    return (
      <div
        data-slot="aui_attachment-preview"
        style={previewSize}
        className={cn(
          'aui-attachment-preview relative shrink-0 cursor-pointer overflow-hidden rounded-lg border',
          previewRem == null && 'size-24',
          className,
        )}
      >
        <img src={previewSrc} alt={name} className="h-full w-full object-cover" />
      </div>
    );
  }

  return (
    <div
      data-slot="aui_attachment-chip"
      style={previewRem != null ? { maxWidth: `${previewRem}rem` } : undefined}
      className={cn(
        'aui-attachment-chip bg-secondary-bg flex max-w-full shrink-0 items-center gap-2 rounded-lg border px-2 py-1.5',
        className,
      )}
    >
      <div className="bg-primary-bg flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md border">
        {isImage && previewSrc ? (
          <Avatar className="size-7 rounded-none">
            <AvatarImage src={previewSrc} alt={name} className="object-cover" />
            <AvatarFallback>
              <Icon name="file" size="1rem" className="text-text-secondary" />
            </AvatarFallback>
          </Avatar>
        ) : (
          <Icon name="file" size="1rem" className="text-text-secondary" />
        )}
      </div>
      <span className="text-text-primary min-w-0 truncate text-sm">{name}</span>
      {onRemove && (
        <Button.Ghost
          type="button"
          size="small"
          aria-label="Remove file"
          title="Remove file"
          className="size-6 shrink-0 rounded-full p-0"
          onClick={onRemove}
        >
          <Icon name="xmark" />
        </Button.Ghost>
      )}
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    AttachmentCard: typeof AttachmentCard;
  }
}
