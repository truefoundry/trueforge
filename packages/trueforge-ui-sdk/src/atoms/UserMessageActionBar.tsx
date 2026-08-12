'use client';

import { Icon } from '../icons/Icon.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { cn } from './lib/cn.js';
import { IconButton } from './primitives/IconButton.js';

export type UserMessageActionBarProps = {
  isCopied: boolean;
  editDisabled?: boolean;
  createdAt?: Date | string;
  onCopy: () => void;
  onEdit: () => void;
  onRetry: () => void;
  className?: string;
};

const actionBtnClass = 'h-6 w-6 text-text-secondary hover:text-text-primary [&_svg]:size-3.5';

export function UserMessageActionBar({
  isCopied,
  editDisabled,
  createdAt,
  onCopy,
  onEdit,
  onRetry,
  className,
}: UserMessageActionBarProps) {
  const MessageTimestamp = useSlot('MessageTimestamp');

  return (
    <div className={cn('aui-user-action-bar-root animate-in fade-in flex items-center gap-1 duration-200', className)}>
      <MessageTimestamp createdAt={createdAt} className="mr-1" />
      <IconButton
        aria-label="Try again"
        tooltip="Try again"
        variant="ghost"
        className={actionBtnClass}
        onClick={onRetry}
      >
        <Icon name="rotate-right" size="0.875em" />
      </IconButton>
      <IconButton
        aria-label="Edit"
        tooltip="Edit"
        variant="ghost"
        className={actionBtnClass}
        disabled={editDisabled}
        onClick={onEdit}
      >
        <Icon name="pencil" size="0.875em" />
      </IconButton>
      <IconButton aria-label="Copy" tooltip="Copy" variant="ghost" className={actionBtnClass} onClick={onCopy}>
        <Icon name={isCopied ? 'check' : 'clone'} size="0.875em" />
      </IconButton>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    UserMessageActionBar: typeof UserMessageActionBar;
  }
}
