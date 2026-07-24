import { useAuiState } from '@assistant-ui/react';
import { PanelLeftIcon } from './icons';

interface Props {
  sidebarCollapsed: boolean;
  onExpandSidebar: () => void;
}

/** Thin top bar matching the product chat header (title only — no branding). */
export function ThreadHeader({ sidebarCollapsed, onExpandSidebar }: Props) {
  const mainThreadId = useAuiState(state => state.threads.mainThreadId);
  const threadItems = useAuiState(state => state.threads.threadItems);
  const rawTitle = threadItems.find(item => item.id === mainThreadId)?.title?.trim();
  const title = rawTitle && rawTitle.length > 0 ? rawTitle : 'New Chat';

  return (
    <header className="app-thread-header">
      {sidebarCollapsed ? (
        <button type="button" className="icon-btn" aria-label="Expand sidebar" onClick={onExpandSidebar}>
          <PanelLeftIcon />
        </button>
      ) : null}
      <strong>{title}</strong>
    </header>
  );
}
