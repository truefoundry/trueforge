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
  sizeBytes?: number;
  previewSrc?: string;
  isImage?: boolean;
  size?: AttachmentCardSize;
  /** When set, constrains image preview and file chip width to this rem size. */
  previewRem?: number;
  onRemove?: () => void;
  className?: string;
};

const FILE_ICON_BY_EXTENSION: Record<string, string> = {
  pdf: 'file-text',
  ppt: 'file-text',
  pptx: 'file-text',
  doc: 'file-text',
  docx: 'file-text',
  txt: 'file-text',
  csv: 'file-spreadsheet',
  xls: 'file-spreadsheet',
  xlsx: 'file-spreadsheet',
  json: 'file-code',
};

export function getAttachmentFileIconName(name: string): string {
  const dotIndex = name.lastIndexOf('.');
  const extension = dotIndex > 0 && dotIndex < name.length - 1 ? name.slice(dotIndex + 1).toLowerCase() : undefined;
  return extension == null ? 'file' : (FILE_ICON_BY_EXTENSION[extension] ?? 'file');
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 1) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${megabytes.toFixed(2)} MB`;
}

export function AttachmentCard({
  name,
  sizeBytes,
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

  const imageChip = isImage && previewSrc != null;
  const fileIcon = getAttachmentFileIconName(name);

  return (
    <div
      data-slot="aui_attachment-chip"
      style={previewRem != null ? { maxWidth: `${previewRem}rem` } : undefined}
      className={cn(
        'aui-attachment-chip relative shrink-0',
        imageChip
          ? 'size-14'
          : 'bg-secondary-bg flex max-w-full min-w-0 items-center gap-3 rounded-lg border border-primary-button-bg/20 p-3',
        !imageChip && onRemove != null && 'pe-10',
        className,
      )}
    >
      {imageChip ? (
        <>
          <div className="bg-secondary-bg relative size-full overflow-hidden rounded-[calc(var(--composer-radius,1.5rem)-var(--composer-padding,8px))] border border-primary-button-bg/20">
            <Avatar className="size-full rounded-none">
              <AvatarImage src={previewSrc} alt={name} className="object-cover" />
              <AvatarFallback className="rounded-none bg-secondary-bg bg-none text-text-secondary">
                <Icon name="file" size="1.5rem" className="text-text-secondary" />
              </AvatarFallback>
            </Avatar>
          </div>
        </>
      ) : (
        <>
          <Icon name={fileIcon} size="2.5rem" className="text-text-secondary" />
          <div className="flex min-w-0 flex-col gap-1">
            <Tooltip content={name} side="top" triggerClassName="min-w-0">
              <span className="text-text-primary min-w-0 truncate text-sm font-medium">{name}</span>
            </Tooltip>
            {sizeBytes != null ? (
              <span className="text-text-secondary text-xs">{formatFileSize(sizeBytes)}</span>
            ) : null}
          </div>
        </>
      )}
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
