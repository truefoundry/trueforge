'use client';

import { useNamedAgentHeaderState } from '../hooks/useChatChromeActionsVisible.js';
import { Icon } from '../icons/Icon.js';
import { cn } from './lib/cn.js';
import { Tooltip } from './primitives/Tooltip.js';

/** Context label for the named agent associated with the current chat. */
export function NamedAgentHeaderLabel({ className }: { className?: string }) {
  const state = useNamedAgentHeaderState();
  if (state === null) return null;

  return (
    <div
      data-slot="aui_named-agent-label"
      className={cn('flex min-w-0 items-center gap-1.5 px-1 text-sm font-medium text-text-primary', className)}
    >
      <Icon name="robot" className="size-3.5 shrink-0" />
      <span className="truncate" title={state.name}>
        {state.name}
      </span>
      {state.isEditing ? (
        <Tooltip content="Try changes here, then choose Update agent to save." side="bottom">
          <span className="border-warning-bg/40 bg-warning-bg/10 text-warning-bg inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium">
            <Icon name="pencil" className="size-3" />
            Editing
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}
