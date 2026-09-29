'use client';

import { Icon } from '../../icons/Icon.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { formatSessionListMetrics } from '../../utils/sessionDisplayFormat.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { formatAbsoluteDateTime } from '../lib/dateFormat.js';
import { formatRelativeShort } from '../lib/threadListMeta.js';
import { DropdownMenu, DropdownMenuItem } from '../primitives/DropdownMenu.js';
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
  onRequestDelete,
  canDelete = true,
}: AgentSessionListRowProps) {
  const PermissionGuard = useSlot('PermissionGuard');
  const activityAt = new Date(lastActivityAt);
  const relative = formatRelativeShort(activityAt);
  const absolute = formatAbsoluteDateTime(activityAt);

  return (
    <div
      data-active={active || undefined}
      className={cn(
        'group flex w-full flex-col border-b border-border transition-colors',
        active ? 'bg-dropdown-selected-item-bg' : 'hover:bg-ghost-button-hover',
      )}
    >
      <div className="flex items-center gap-2 px-4 pt-3">
        <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-1 text-left">
          <span className="truncate text-sm font-medium text-text-primary">{title}</span>
          {sourceType === 'schedule' ? (
            <Tooltip content="Scheduled Session">
              <span aria-label="Scheduled run" className="inline-flex shrink-0">
                <Icon name="calendar" className="size-3.5 text-primary-button-bg" />
              </span>
            </Tooltip>
          ) : null}
        </button>
        {onRequestDelete != null ? (
          <div
            className={cn(
              'ml-auto shrink-0 transition-opacity',
              // Visible below md; md+ hide until hover/focus/open (same pattern as ThreadListRow).
              // md: variants survive host Tailwind tree-shaking.
              'md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:group-has-[[aria-expanded=true]]:opacity-100',
            )}
            onClick={event => event.stopPropagation()}
            onKeyDown={event => event.stopPropagation()}
          >
            <DropdownMenu
              align="end"
              className="min-w-40"
              trigger={
                <button
                  type="button"
                  className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'size-7' })}
                  aria-label={`Actions for ${title}`}
                >
                  <Icon name="ellipsis" />
                </button>
              }
            >
              <PermissionGuard allowed={canDelete}>
                <DropdownMenuItem
                  className="whitespace-nowrap text-failure-bg focus-visible:text-failure-bg"
                  onClick={() => {
                    if (canDelete) onRequestDelete();
                  }}
                >
                  <Icon name="trash" className="size-3.5" />
                  Delete
                </DropdownMenuItem>
              </PermissionGuard>
            </DropdownMenu>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-end justify-between gap-2 px-4 pt-2 pb-3 text-left text-xs text-text-secondary"
      >
        <span className="flex min-w-0 items-center gap-1">
          {agentName != null ? (
            <>
              <Icon name="agent-2" className="size-3 shrink-0" />
              <span className="truncate">{agentName}</span>
              <span aria-hidden="true">·</span>
            </>
          ) : null}
          <Tooltip content={absolute} side="bottom">
            <span>{relative}</span>
          </Tooltip>
        </span>
        <span className="shrink-0 tabular-nums">{formatSessionListMetrics(metrics)}</span>
      </button>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentSessionListRow: typeof AgentSessionListRow;
  }
}
