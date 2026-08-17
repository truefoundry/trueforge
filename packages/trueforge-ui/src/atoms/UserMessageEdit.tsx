import type { HTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';

import { cn } from './lib/cn.js';

export type UserMessageEditProps = {
  /** Timestamp node rendered beside the "User" label. */
  timestamp?: ReactNode;
  /** Read-only attachments shown above the input while editing. */
  attachments?: ReactNode;
  input: ReactNode;
  footer: ReactNode;
  className?: string;
};

export const UserMessageEdit = forwardRef<HTMLDivElement, UserMessageEditProps & HTMLAttributes<HTMLDivElement>>(
  function UserMessageEdit({ timestamp, attachments, input, footer, className, ...rest }, ref) {
    return (
      <div
        ref={ref}
        data-slot="aui_user-message-edit"
        className={cn('flex flex-col gap-2 w-full', className)}
        {...rest}
      >
        {(timestamp || attachments) && (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <span className="font-medium text-text-primary">User</span>
            {timestamp}
          </div>
        )}
        {attachments && <div className="flex flex-wrap gap-1">{attachments}</div>}
        <div className="w-full">{input}</div>
        <div>{footer}</div>
      </div>
    );
  },
);

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    UserMessageEdit: typeof UserMessageEdit;
  }
}
