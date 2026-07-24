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
  // A thread started locally keeps its local id as mainThreadId, while the
  // reloaded backend list carries the title under the remote id. Follow the
  // remoteId link so the header picks up the backend-generated title.
  const mainItem = threadItems.find(item => item.id === mainThreadId);
  const listItem = threadItems.find(item => item.id === mainItem?.remoteId);
  const rawTitle = (listItem?.title ?? mainItem?.title)?.trim();
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
