'use client';

import { Icon } from '../icons/Icon.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { cn } from './lib/cn.js';
import { IconButton } from './primitives/IconButton.js';

export type MessageActionBarProps = {
  isCopied: boolean;
  onCopy: () => void;
  createdAt?: Date | string;
  className?: string;
};

const actionBtnClass = 'h-6 w-6 text-text-secondary hover:text-text-primary [&_svg]:size-3.5';

export function MessageActionBar({ isCopied, onCopy, createdAt, className }: MessageActionBarProps) {
  const MessageTimestamp = useSlot('MessageTimestamp');

  return (
    <div
      className={cn('aui-assistant-action-bar-root animate-in fade-in flex items-center gap-1 duration-200', className)}
    >
      <MessageTimestamp createdAt={createdAt} className="mr-1" />
      <IconButton aria-label="Copy" tooltip="Copy" variant="ghost" className={actionBtnClass} onClick={onCopy}>
        <Icon name={isCopied ? 'check' : 'clone'} size="0.875em" />
      </IconButton>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    MessageActionBar: typeof MessageActionBar;
  }
}
