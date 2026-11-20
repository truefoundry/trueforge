'use client';

import { Icon } from '../../icons/Icon.js';
import { toInputBreakdownBarData } from '../../utils/buildSessionMetrics.js';
import { formatCostUsd, formatDurationMs, formatTokenCount } from '../../utils/sessionDisplayFormat.js';
import { LightTooltip } from '../primitives/Tooltip.js';
import { TokenUsageTooltip } from './AgentSessionMetricCharts.js';
import type { AgentSessionTurnHeaderProps } from './types.js';

export function AgentSessionTurnHeader({
  turnNumber,
  totalTokens,
  inputTokens,
  outputTokens,
  cachedTokens,
  cacheReadTokens,
  cacheWriteTokens,
  inputTokensBreakdown,
  durationMs,
  totalCostInUsd,
  modelName,
}: AgentSessionTurnHeaderProps) {
  const hasMetrics = totalTokens != null || durationMs != null || totalCostInUsd != null || modelName != null;
  const hasTokenBreakdown =
    inputTokens != null ||
    outputTokens != null ||
    cachedTokens != null ||
    cacheReadTokens != null ||
    cacheWriteTokens != null;
  const hasCacheSplit = cacheReadTokens != null || cacheWriteTokens != null;
  const breakdownCacheRead = cacheReadTokens ?? 0;
  const breakdownCacheWrite = cacheWriteTokens ?? 0;
  const breakdownOutput = outputTokens ?? 0;
  const cacheInInput = hasCacheSplit ? breakdownCacheRead + breakdownCacheWrite : (cachedTokens ?? 0);
  const breakdownInput = (inputTokens ?? 0) + cacheInInput;

  const tokensTrigger =
    totalTokens != null ? (
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-sm text-inherit"
        aria-label={
          hasTokenBreakdown
            ? `Tokens ${formatTokenCount(totalTokens)}. Input ${formatTokenCount(breakdownInput)}, Output ${formatTokenCount(breakdownOutput)}, Cache read ${formatTokenCount(breakdownCacheRead)}, Cache write ${formatTokenCount(breakdownCacheWrite)}`
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
                  <TokenUsageTooltip
                    totalTokens={totalTokens ?? 0}
                    inputTokens={breakdownInput}
                    outputTokens={breakdownOutput}
                    cacheReadTokens={breakdownCacheRead}
                    cacheWriteTokens={breakdownCacheWrite}
                    inputBreakdown={inputTokensBreakdown == null ? [] : toInputBreakdownBarData(inputTokensBreakdown)}
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
