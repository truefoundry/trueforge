'use client';

import { useNamedAgentHeaderState } from '../hooks/useChatChromeActionsVisible.js';
import { Icon } from '../icons/Icon.js';
import { cn } from './lib/cn.js';

/** Left-of-header title for a named agent, including its mutable edit state. */
export function NamedAgentHeaderLabel({ className }: { className?: string }) {
  const state = useNamedAgentHeaderState();
  if (state === null) return null;

  return (
    <h1
      className={cn('flex min-w-0 items-center gap-1.5 px-1 text-sm font-medium text-text-primary', className)}
      title={state.name}
    >
      <Icon name="robot" className="size-3.5 shrink-0" />
      <span className="truncate">{state.name}</span>
      {state.isEditing ? (
        <span className="bg-secondary-bg text-text-secondary inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
          <Icon name="pencil" className="size-3" />
          Editing
        </span>
      ) : null}
    </h1>
  );
}
