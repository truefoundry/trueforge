'use client';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import { useAuiState } from '../assistant-ui.js';
import { useNamedAgentHeaderState } from '../hooks/useChatChromeActionsVisible.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import { pageHeaderTitleClassName } from './PageHeader.js';
/** Dynamic chat title for named agents and New Chat / New Agent drafts. */
export function NamedAgentHeaderLabel({ className }: { className?: string }) {
  const shell = useOptionalShellMode();
  const track = useTrackAnalytics();
  const state = useNamedAgentHeaderState();
  const threadTitle = useAuiState(s => s.threadListItem.title);
  if (state === null) return null;

  const syncedTitle = threadTitle?.trim() ?? '';
  const displayName = state.allowThreadTitle && syncedTitle.length > 0 ? syncedTitle : state.name;
  const showBackToAgents = shell?.isLibraryEnabled === true && shell.historyAgentFilter?.intent === 'try-agent';
  // Try Agent (and Edit) carry a bound agent identity — show the design’s agent file icon before the name.
  const showAgentIcon =
    shell?.mode.status === 'active' &&
    (shell.mode.isMutable === false || (shell.mode.isMutable && shell.mode.agentId != null));

  return (
    <h1 className={cn('flex min-w-0 items-center gap-1.5', pageHeaderTitleClassName, className)}>
      {showBackToAgents ? (
        <button
          type="button"
          aria-label="Back to all agents"
          title="Back to all agents"
          className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'text-text-secondary' })}
          onClick={() => {
            track(AnalyticsEvents.Library.OPENED);
            shell?.setLibraryOpen(true);
          }}
        >
          <Icon name="arrow-left" />
        </button>
      ) : null}
      {showAgentIcon ? <Icon name="agent-2" className="text-text-secondary size-4 shrink-0" aria-hidden /> : null}
      <span className="truncate" title={displayName}>
        {displayName}
      </span>
    </h1>
  );
}
