'use client';

import { useAuiState } from '../assistant-ui.js';
import { cn } from './lib/cn.js';

const UNTITLED_CHAT_LABEL = 'New Chat';

/** Current chat title shown persistently above the conversation. */
export function ChatTitleHeaderLabel({ className }: { className?: string }) {
  const title = useAuiState(state => {
    const { mainThreadId, threadItems } = state.threads;
    return threadItems.find(item => item.id === mainThreadId)?.title;
  });
  const displayTitle = title?.trim() || UNTITLED_CHAT_LABEL;

  return (
    <h1
      data-slot="aui_chat-title"
      className={cn('min-w-0 flex-1 truncate px-1 text-sm font-medium text-text-primary', className)}
      title={displayTitle}
    >
      {displayTitle}
    </h1>
  );
}
