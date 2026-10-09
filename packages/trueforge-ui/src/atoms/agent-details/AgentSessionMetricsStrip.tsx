'use client';

import type { ComponentType, ReactNode } from 'react';

import { Icon } from '../../icons/Icon.js';
import { formatCostUsd, formatReadableDurationMs, formatTokenCount } from '../../utils/sessionDisplayFormat.js';
import { formatTimelineDuration } from '../../utils/sessionEventTimeline.js';
import { cn } from '../lib/cn.js';
import { LightTooltip } from '../primitives/Tooltip.js';
import {
  CostBreakdownRows,
  HorizontalBarRows,
  SessionMetricTooltipContent,
  StackedProportionBar,
} from './AgentSessionMetricCharts.js';
import type { AgentSessionMetricsStripProps } from './types.js';

const SESSION_LINEAGE_TURNS_TOOLTIP =
  'Some turns in this session were edited or retried. Showing only the latest lineage of the session';

function SessionMetricTile({
  id,
  label,
  value,
  tooltip,
}: {
  id: string;
  label: string;
  value: ReactNode;
  tooltip?: ReactNode;
}) {
  const content = (
    <div
      className="h-full w-full border-b border-r border-border bg-primary-bg px-3 py-2"
      data-slot={`session-metric-${id}`}
    >
      <div className="mb-0.5 flex items-center gap-1 text-[0.625rem] font-medium uppercase tracking-wider text-text-secondary">
        {label}
        {tooltip != null ? <Icon name="info" className="size-2.5 text-text-secondary" /> : null}
      </div>
      <div className="pt-1 text-base font-medium leading-none text-text-primary">{value}</div>
    </div>
  );
  if (tooltip == null) return content;
  return (
    <LightTooltip title={tooltip} side="bottom" triggerClassName="block w-full">
      {content}
    </LightTooltip>
  );
}

function SessionTurnsMetricTile({
  lineageTurns,
  sessionTotalTurns,
}: {
  lineageTurns: number;
  sessionTotalTurns?: number;
}) {
  const showLineageSplit = sessionTotalTurns != null && sessionTotalTurns > lineageTurns;
  const label = lineageTurns > 1 || (sessionTotalTurns != null && sessionTotalTurns > 1) ? 'Turns' : 'Turn';

  const value = showLineageSplit ? (
    <span className="inline-flex h-4 items-center gap-2">
      <span className="leading-none">
        <span className="text-primary-button-bg">{lineageTurns} </span>
        <span className="text-text-primary">/ {sessionTotalTurns}</span>
      </span>
      <Icon
        name="circle-exclamation"
        size={16}
        className="size-4 shrink-0 text-warning-bg"
        data-testid="icon-circle-exclamation"
      />
    </span>
  ) : (
    lineageTurns
  );

  const tile = (
    <div
      className="h-full w-full border-b border-r border-border bg-primary-bg px-3 py-2"
      data-slot="session-metric-turns"
    >
      <div className="mb-0.5 flex items-center gap-1 text-[0.625rem] font-medium uppercase tracking-wider text-text-secondary">
        {label}
      </div>
      <div className="flex items-center pt-1 text-base font-medium leading-none text-text-primary">{value}</div>
    </div>
  );

  if (!showLineageSplit) return tile;
  return (
    <LightTooltip
      title={SESSION_LINEAGE_TURNS_TOOLTIP}
      side="bottom"
      triggerClassName="block w-full"
      className="max-w-56 whitespace-normal"
    >
      {tile}
    </LightTooltip>
  );
}

export function AgentSessionMetricsStrip({ metrics }: AgentSessionMetricsStripProps) {
  return (
    <div className="@container overflow-hidden border-b border-border" data-slot="agent-session-metrics-strip">
      <div
        className={cn(
          '-mb-px -mr-px grid grid-cols-3 @min-[24rem]:grid-cols-4',
          metrics.totalCostUsd == null ? '@min-[48rem]:grid-cols-7' : '@min-[48rem]:grid-cols-8',
        )}
      >
        <SessionTurnsMetricTile lineageTurns={metrics.totalTurns} sessionTotalTurns={metrics.sessionTotalTurns} />
        <SessionMetricTile
          id="wall-time"
          label="Duration"
          value={formatReadableDurationMs(metrics.wallTimeMs)}
          tooltip={
            <SessionMetricTooltipContent title="Where the time went">
              <StackedProportionBar data={metrics.timeBreakdown} formatValue={formatTimelineDuration} />
            </SessionMetricTooltipContent>
          }
        />
        {metrics.totalCostUsd != null ? (
          <SessionMetricTile
            id="cost"
            label="Cost"
            value={formatCostUsd(metrics.totalCostUsd)}
            tooltip={
              metrics.costPerTurn.length > 1 && metrics.totalCostUsd > 0 ? (
                <SessionMetricTooltipContent title="Cost per turn">
                  <CostBreakdownRows data={metrics.costPerTurn} />
                </SessionMetricTooltipContent>
              ) : null
            }
          />
        ) : null}
        <SessionMetricTile
          id="tokens"
          label="Tokens"
          value={formatTokenCount(metrics.totalTokens)}
          tooltip={
            metrics.totalTokens > 0 ? (
              <SessionMetricTooltipContent title="Tokens">
                <StackedProportionBar data={metrics.tokenBreakdown} formatValue={formatTokenCount} />
              </SessionMetricTooltipContent>
            ) : null
          }
        />
        <SessionMetricTile
          id="context"
          label="Context"
          value={formatTokenCount(metrics.contextTokens)}
          tooltip={
            metrics.contextByTurn.length > 1 && metrics.contextTokens > 0 ? (
              <SessionMetricTooltipContent title="Context length at end of turn">
                <HorizontalBarRows data={metrics.contextByTurn} formatValue={formatTokenCount} />
              </SessionMetricTooltipContent>
            ) : null
          }
        />
        <SessionMetricTile
          id="tool-calls"
          label="Tool calls"
          value={metrics.toolCalls}
          tooltip={
            metrics.toolCalls > 1 ? (
              <SessionMetricTooltipContent title="Tool call frequency">
                <HorizontalBarRows data={metrics.toolCallFrequency} formatValue={String} />
              </SessionMetricTooltipContent>
            ) : null
          }
        />
        <SessionMetricTile id="sub-agents" label="Sub-agents" value={metrics.subAgents} />
        <SessionMetricTile id="errors" label="Errors" value={metrics.errors} />
      </div>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentSessionMetricsStrip: ComponentType<AgentSessionMetricsStripProps>;
  }
}
