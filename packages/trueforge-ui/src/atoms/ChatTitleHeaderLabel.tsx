'use client';

import { useAuiState } from '../assistant-ui.js';
import { displayChatTitle } from '../utils/chatTitle.js';
import { cn } from './lib/cn.js';

/** Current conversation title shown in layout headers. */
export function ChatTitleHeaderLabel({ className }: { className?: string }) {
  const title = useAuiState(s => s.threadListItem.title);
  const displayTitle = displayChatTitle(title);

  return (
    <div className={cn('min-w-0 flex-1 px-1', className)}>
      <span
        data-slot="aui_chat-title"
        className="block truncate text-sm font-semibold text-text-primary"
        title={displayTitle}
      >
        {displayTitle}
      </span>
    </div>
  );
}
