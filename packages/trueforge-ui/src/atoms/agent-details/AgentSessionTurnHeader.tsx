'use client';

import { Icon } from '../../icons/Icon.js';
import { formatCostUsd, formatDurationMs, formatTokenCount } from '../../utils/sessionDisplayFormat.js';
import type { AgentSessionTurnHeaderProps } from './types.js';

export function AgentSessionTurnHeader({
  turnNumber,
  totalTokens,
  durationMs,
  totalCostInUsd,
}: AgentSessionTurnHeaderProps) {
  const hasMetrics = totalTokens != null || durationMs != null || totalCostInUsd != null;

  return (
    <div className="flex items-center gap-3 py-1 text-xs text-text-secondary">
      <span className="shrink-0 font-semibold text-text-primary">{`Turn ${turnNumber}`}</span>
      <div className="h-px min-w-4 flex-1 bg-border" aria-hidden="true" />
      {hasMetrics ? (
        <div className="flex shrink-0 items-center gap-3 tabular-nums">
          {totalTokens != null ? (
            <span className="inline-flex items-center gap-1">
              <Icon name="link" className="size-3.5 shrink-0" />
              {`Tokens ${formatTokenCount(totalTokens)}`}
            </span>
          ) : null}
          {durationMs != null ? (
            <span className="inline-flex items-center gap-1">
              <Icon name="clock" className="size-3.5 shrink-0" />
              {`Duration ${formatDurationMs(durationMs)}`}
            </span>
          ) : null}
          {totalCostInUsd != null ? <span>{`Cost ${formatCostUsd(totalCostInUsd)}`}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentSessionTurnHeader: typeof AgentSessionTurnHeader;
  }
}
