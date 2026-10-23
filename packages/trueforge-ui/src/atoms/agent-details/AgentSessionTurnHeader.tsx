'use client';

import { Icon } from '../../icons/Icon.js';
import { formatCostUsd, formatDurationMs, formatTokenCount } from '../../utils/sessionDisplayFormat.js';
import { LightTooltip } from '../primitives/Tooltip.js';
import type { AgentSessionTurnHeaderProps } from './types.js';

function TurnTokenBreakdownTooltip({
  inputTokens,
  outputTokens,
  cachedTokens,
}: {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}) {
  const rows = [
    { label: 'Input', value: inputTokens },
    { label: 'Output', value: outputTokens },
    { label: 'Cached', value: cachedTokens },
  ] as const;
  return (
    <div className="min-w-28 px-2 py-1.5 text-xs text-text-primary">
      <div className="flex flex-col gap-1">
        {rows.map(row => (
          <div key={row.label} className="flex items-center justify-between gap-4">
            <span className="text-text-secondary">{row.label}</span>
            <span className="tabular-nums font-medium text-text-primary">{formatTokenCount(row.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AgentSessionTurnHeader({
  turnNumber,
  totalTokens,
  inputTokens,
  outputTokens,
  cachedTokens,
  durationMs,
  totalCostInUsd,
  modelName,
}: AgentSessionTurnHeaderProps) {
  const hasMetrics = totalTokens != null || durationMs != null || totalCostInUsd != null || modelName != null;
  const hasTokenBreakdown = inputTokens != null || outputTokens != null || cachedTokens != null;
  const breakdownInput = inputTokens ?? 0;
  const breakdownOutput = outputTokens ?? 0;
  const breakdownCached = cachedTokens ?? 0;

  const tokensTrigger =
    totalTokens != null ? (
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-sm text-inherit"
        aria-label={
          hasTokenBreakdown
            ? `Tokens ${formatTokenCount(totalTokens)}. Input ${formatTokenCount(breakdownInput)}, Output ${formatTokenCount(breakdownOutput)}, Cached ${formatTokenCount(breakdownCached)}`
            : `Tokens ${formatTokenCount(totalTokens)}`
        }
      >
        <Icon name="link" className="size-3.5 shrink-0" aria-hidden />
        Tokens <span className="font-semibold">{formatTokenCount(totalTokens)}</span>
      </button>
    ) : null;

  return (
    <div className="flex flex-col gap-2 text-xs text-text-secondary">
      <span className="font-semibold text-text-primary">{`Turn ${turnNumber}`}</span>
      {hasMetrics ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
          {modelName != null ? (
            <LightTooltip title={modelName} side="bottom">
              <span className="inline-flex min-w-0 items-center gap-1">
                <Icon name="cube" className="size-3.5 shrink-0" aria-hidden />
                <span className="shrink-0">Model</span>
                <span className="max-w-64 truncate font-semibold">{modelName}</span>
              </span>
            </LightTooltip>
          ) : null}
          {tokensTrigger != null ? (
            hasTokenBreakdown ? (
              <LightTooltip
                title={
                  <TurnTokenBreakdownTooltip
                    inputTokens={breakdownInput}
                    outputTokens={breakdownOutput}
                    cachedTokens={breakdownCached}
                  />
                }
                side="bottom"
              >
                {tokensTrigger}
              </LightTooltip>
            ) : (
              tokensTrigger
            )
          ) : null}
          {durationMs != null ? (
            <span className="inline-flex items-center gap-1">
              <Icon name="clock" className="size-3.5 shrink-0" />
              Duration <span className="font-semibold">{formatDurationMs(durationMs)}</span>
            </span>
          ) : null}
          {totalCostInUsd != null ? (
            <span>
              Cost <span className="font-semibold">{formatCostUsd(totalCostInUsd)}</span>
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="h-px w-full bg-border" aria-hidden="true" />
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentSessionTurnHeader: typeof AgentSessionTurnHeader;
  }
}
