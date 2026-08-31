'use client';

import { Icon } from '../../icons/Icon.js';
import { formatSessionListMetrics } from '../../utils/sessionDisplayFormat.js';
import { cn } from '../lib/cn.js';
import { formatRelativeShort } from '../lib/threadListMeta.js';
import type { AgentSessionListRowProps } from './types.js';

export function AgentSessionListRow({
  title,
  agentName,
  lastActivityAt,
  metrics,
  active,
  onSelect,
}: AgentSessionListRowProps) {
  const relative = formatRelativeShort(new Date(lastActivityAt));

  return (
    <button
      type="button"
      onClick={onSelect}
      data-active={active || undefined}
      className={cn(
        'flex w-full flex-col gap-2 border-b border-border px-3 py-3 text-left transition-colors',
        active ? 'bg-dropdown-selected-item-bg' : 'hover:bg-ghost-button-hover',
      )}
    >
      <span className="line-clamp-2 text-sm font-medium text-text-primary">{title}</span>
      <span className="flex items-end justify-between gap-2 text-xs text-text-secondary">
        <span className="flex min-w-0 items-center gap-1">
          {agentName != null ? (
            <>
              <Icon name="robot" className="size-3 shrink-0" />
              <span className="truncate">{agentName}</span>
            </>
          ) : (
            <span>Draft</span>
          )}
          <span aria-hidden="true">·</span>
          <span>{relative}</span>
        </span>
        <span className="shrink-0 tabular-nums">{formatSessionListMetrics(metrics)}</span>
      </span>
    </button>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentSessionListRow: typeof AgentSessionListRow;
  }
}
