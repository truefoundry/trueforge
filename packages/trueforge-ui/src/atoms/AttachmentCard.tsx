'use client';

import { USER_MESSAGE_ATTACHMENT_PREVIEW_REM } from '../constants/attachments.js';
import { Icon } from '../icons/Icon.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import { Avatar, AvatarFallback, AvatarImage } from './primitives/Avatar.js';
import { Tooltip } from './primitives/Tooltip.js';

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
          'aui-attachment-preview relative shrink-0 cursor-pointer overflow-hidden rounded-lg border border-primary-button-bg/20',
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
      className={cn('aui-attachment-chip relative size-14 shrink-0', className)}
    >
      <Tooltip content={name} side="top" triggerClassName="size-full">
        <div className="bg-secondary-bg relative size-full overflow-hidden rounded-[calc(var(--composer-radius,1.5rem)-var(--composer-padding,8px))] border border-primary-button-bg/20">
          <Avatar className="size-full rounded-none">
            <AvatarImage src={isImage ? previewSrc : undefined} alt={name} className="object-cover" />
            <AvatarFallback className="rounded-none">
              <Icon name="file" size="1.5rem" className="text-text-secondary" />
            </AvatarFallback>
          </Avatar>
        </div>
      </Tooltip>
      <span className="sr-only">{name}</span>
      {onRemove && (
        <button
          type="button"
          aria-label="Remove file"
          title="Remove file"
          className={auiButtonClass({
            variant: 'ghost',
            size: 'icon',
            className:
              'aui-attachment-tile-remove absolute inset-e-1 top-1 z-10 size-5 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white',
          })}
          onClick={e => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <Icon name="xmark" size="0.75rem" />
        </button>
      )}
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    AttachmentCard: typeof AttachmentCard;
  }
}
