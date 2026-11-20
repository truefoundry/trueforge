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
import { Tooltip } from './primitives/Tooltip.js';

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
      <span className="truncate" title={displayName}>
        {displayName}
      </span>
      {state.isEditing ? (
        <Tooltip content="Try changes here, then choose Update agent to save." side="bottom">
          <span className="border-warning-bg/40 bg-warning-bg/10 text-warning-bg inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium">
            <Icon name="pencil" className="size-3" />
            Editing
          </span>
        </Tooltip>
      ) : null}
    </h1>
  );
}
