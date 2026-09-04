'use client';

import { useAuiState } from '../assistant-ui.js';
import { useNamedAgentHeaderState } from '../hooks/useChatChromeActionsVisible.js';
import { Icon } from '../icons/Icon.js';
import { cn } from './lib/cn.js';
import { Tooltip } from './primitives/Tooltip.js';

/** Left-of-header title for named agents and New Chat / New Agent drafts. */
export function NamedAgentHeaderLabel({ className }: { className?: string }) {
  const state = useNamedAgentHeaderState();
  const threadTitle = useAuiState(s => s.threadListItem.title);
  if (state === null) return null;

  const syncedTitle = threadTitle?.trim() ?? '';
  const displayName = state.allowThreadTitle && syncedTitle.length > 0 ? syncedTitle : state.name;

  return (
    <h1
      className={cn(
        // Match sm/icon chrome buttons so header height doesn't collapse when Clear/Save hide.
        'flex min-h-8 min-w-0 items-center gap-1.5 px-1 text-sm font-medium text-text-primary',
        className,
      )}
    >
      <Icon name={state.icon} className="size-3.5 shrink-0" />
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
