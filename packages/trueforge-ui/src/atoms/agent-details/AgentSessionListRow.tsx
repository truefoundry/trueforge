'use client';

import { Icon } from '../../icons/Icon.js';
import { formatSessionListMetrics } from '../../utils/sessionDisplayFormat.js';
import { cn } from '../lib/cn.js';
import { formatRelativeShort } from '../lib/threadListMeta.js';
import { Tooltip } from '../primitives/Tooltip.js';
import type { AgentSessionListRowProps } from './types.js';

export function AgentSessionListRow({
  title,
  agentName,
  sourceType,
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
      <span className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-sm font-medium text-text-primary">{title}</span>
        {sourceType === 'schedule' ? (
          <Tooltip content="Scheduled run">
            <span aria-label="Scheduled run" className="mt-0.5 inline-flex shrink-0">
              <Icon name="calendar" className="size-3.5" />
            </span>
          </Tooltip>
        ) : null}
      </span>
      <span className="flex items-end justify-between gap-2 text-xs text-text-secondary">
        <span className="flex min-w-0 items-center gap-1">
          {agentName != null ? (
            <>
              <Icon name="agent-2" className="size-3 shrink-0" />
              <span className="truncate">{agentName}</span>
              <span aria-hidden="true">·</span>
            </>
          ) : null}
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
