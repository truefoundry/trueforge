'use client';

import type { ReactNode } from 'react';

import { cn } from './lib/cn.js';

export type UserMessageBubbleProps = {
  text: string;
  attachments?: ReactNode;
  editAction?: ReactNode;
  className?: string;
};

export function UserMessageBubble({ text, attachments, editAction, className }: UserMessageBubbleProps) {
  return (
    <div
      data-slot="aui_user-message-root"
      className={cn('group/user-message flex w-full min-w-0 flex-col items-end gap-1', className)}
    >
      {attachments}
      <div
        data-slot="aui_user-message-content"
        style={{ borderRadius: 'var(--composer-radius, 1.5rem)' }}
        className="max-w-[min(80%,100%)] min-w-0 bg-user-message-bg px-3 py-2 text-sm text-user-message-text whitespace-pre-wrap break-words sm:px-4 sm:py-2.5"
      >
        {text}
      </div>
      {editAction && (
        <div className="flex max-w-[min(80%,100%)] justify-end opacity-0 transition-opacity group-hover/user-message:opacity-100 focus-within:opacity-100">
          {editAction}
        </div>
      )}
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    UserMessageBubble: typeof UserMessageBubble;
  }
}
