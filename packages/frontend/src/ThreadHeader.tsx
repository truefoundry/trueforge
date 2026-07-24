import { useAuiState } from '@assistant-ui/react';

/** Thin top bar matching the product chat header (title only — no branding). */
export function ThreadHeader() {
  const mainThreadId = useAuiState(state => state.threads.mainThreadId);
  const threadItems = useAuiState(state => state.threads.threadItems);
  const rawTitle = threadItems.find(item => item.id === mainThreadId)?.title?.trim();
  const title = rawTitle && rawTitle.length > 0 ? rawTitle : 'New Chat';

  return (
    <header className="app-thread-header">
      <strong>{title}</strong>
    </header>
  );
}
