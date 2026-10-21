'use client';

import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';

import { formatRelativeShort } from './lib/threadListMeta.js';
import {
  AGENT_LIBRARY_METERS_WINDOW_DAYS,
  AGENT_LIBRARY_SPARKLINE_DAYS,
  type AgentLibraryDailyPoint,
  type AgentLibraryUsageStats,
} from './lib/useAgentLibraryUsageStats.js';
import { Skeleton } from './primitives/Skeleton.js';
import { Tooltip } from './primitives/Tooltip.js';

/** Listing spend (e.g. $151.85). */
function formatLibraryCostUsd(costInUsd: number): string {
  return `$${costInUsd.toFixed(2)}`;
}

/** Backend day buckets are UTC midnight; local calendar would name the previous day west of UTC. */
const sparklineDayFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

function formatSparklineDay(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return sparklineDayFormatter.format(new Date(ms));
}

function formatLastRunLabel(iso: string | null): string {
  if (iso == null) return 'Never';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  return `${formatRelativeShort(new Date(ms))} ago`;
}

export const agentLibraryUsageLabels = {
  sessions: `Sessions, ${String(AGENT_LIBRARY_METERS_WINDOW_DAYS)}d`,
  spend: `Spend, ${String(AGENT_LIBRARY_METERS_WINDOW_DAYS)}d`,
  daily: `Daily, ${String(AGENT_LIBRARY_SPARKLINE_DAYS)}d`,
} as const;

function nearestSparklineIndex({
  clientX,
  svg,
  count,
  width,
}: {
  clientX: number;
  svg: SVGSVGElement;
  count: number;
  width: number;
}): number {
  if (count <= 1) return 0;
  const rect = svg.getBoundingClientRect();
  const x = ((clientX - rect.left) / Math.max(rect.width, 1)) * width;
  const step = width / (count - 1);
  return Math.max(0, Math.min(count - 1, Math.round(x / step)));
}

function AgentLibrarySparkline({
  points,
  agentName,
}: {
  points: readonly AgentLibraryDailyPoint[] | null | undefined;
  agentName: string;
}) {
  const [hover, setHover] = useState<{
    index: number;
    clientX: number;
    clientY: number;
  } | null>(null);

  if (points == null) {
    return (
      <span className="text-text-secondary text-sm" aria-label={`Activity unavailable for ${agentName}`}>
        —
      </span>
    );
  }
  if (points.length === 0 || points.every(point => point.value === 0)) {
    return (
      <span
        className="bg-border/80 mt-3 block h-px w-20"
        aria-label={`No activity in the last 14 days for ${agentName}`}
      />
    );
  }

  const width = 80;
  const height = 28;
  const padY = 2;
  // Spend is never negative; anchoring at 0 keeps a cheap day from looking like a crash.
  const max = Math.max(0, ...points.map(point => point.value));
  const span = max || 1;
  const stepX = points.length === 1 ? 0 : width / (points.length - 1);
  const coords = points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : index * stepX;
    const y = height - padY - (Math.max(0, point.value) / span) * (height - padY * 2);
    return { x, y };
  });
  const polyline = coords.map(({ x, y }) => `${String(x)},${String(y)}`).join(' ');
  const hoverPoint = hover != null ? points[hover.index] : null;
  const hoverCoord = hover != null ? coords[hover.index] : null;

  const onMouseMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    const index = nearestSparklineIndex({
      clientX: event.clientX,
      svg: event.currentTarget,
      count: points.length,
      width,
    });
    setHover({ index, clientX: event.clientX, clientY: event.clientY });
  };

  return (
    <Tooltip
      open={hover != null && hoverPoint != null}
      anchor={hover != null ? { left: hover.clientX, top: hover.clientY } : null}
      interactive={false}
      content={
        hoverPoint == null ? null : (
          <span className="flex flex-col gap-0.5 text-left">
            <span className="text-text-secondary">{formatSparklineDay(hoverPoint.timestamp)}</span>
            <span className="font-medium">{formatLibraryCostUsd(hoverPoint.value)}</span>
          </span>
        )
      }
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        className="cursor-crosshair overflow-visible text-success-bg"
        aria-label={`Daily spend over 14 days for ${agentName}`}
        role="img"
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHover(null)}
      >
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={polyline}
        />
        {hoverCoord != null ? (
          <>
            <line
              x1={hoverCoord.x}
              x2={hoverCoord.x}
              y1={0}
              y2={height}
              stroke="currentColor"
              strokeOpacity={0.25}
              strokeWidth={1}
            />
            <circle cx={hoverCoord.x} cy={hoverCoord.y} r={2.5} fill="currentColor" />
          </>
        ) : null}
      </svg>
    </Tooltip>
  );
}

export function AgentLibrarySparklineCell({
  points,
  loading,
  agentName,
}: {
  points: readonly AgentLibraryDailyPoint[] | null | undefined;
  loading: boolean;
  agentName: string;
}) {
  if (loading) return <Skeleton className="h-7 w-20 rounded" />;
  return <AgentLibrarySparkline points={points} agentName={agentName} />;
}

export function AgentSessionsCell({
  usage,
  loading,
  agentName,
}: {
  usage: AgentLibraryUsageStats | undefined;
  loading: boolean;
  agentName: string;
}) {
  if (loading) return <Skeleton className="h-4 w-8 rounded" />;
  if (usage?.totalSessions == null) {
    return (
      <span className="text-text-secondary text-sm" aria-label={`Session count unavailable for ${agentName}`}>
        —
      </span>
    );
  }
  return (
    <span className="text-text-primary text-sm font-medium" aria-label={`${String(usage.totalSessions)} sessions`}>
      {usage.totalSessions}
    </span>
  );
}

export function AgentSpendCell({
  usage,
  loading,
  agentName,
}: {
  usage: AgentLibraryUsageStats | undefined;
  loading: boolean;
  agentName: string;
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-1">
        <Skeleton className="h-4 w-14 rounded" />
        <Skeleton className="h-3 w-20 rounded" />
      </div>
    );
  }
  if (usage?.totalCostUsd == null) {
    return (
      <span className="text-text-secondary text-sm" aria-label={`Spend unavailable for ${agentName}`}>
        —
      </span>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-text-primary text-sm font-medium">{formatLibraryCostUsd(usage.totalCostUsd)}</span>
      {usage.costPerSessionUsd != null ? (
        <span className="text-text-secondary text-xs">{formatLibraryCostUsd(usage.costPerSessionUsd)} / session</span>
      ) : null}
    </div>
  );
}

export function AgentLastRunCell({
  usage,
  loading,
  agentName,
}: {
  usage: AgentLibraryUsageStats | undefined;
  loading: boolean;
  agentName: string;
}) {
  if (loading) return <Skeleton className="h-4 w-16 rounded" />;
  if (usage?.lastRunAt === undefined) {
    return (
      <span
        className="text-text-secondary whitespace-nowrap text-sm"
        aria-label={`Last run unavailable for ${agentName}`}
      >
        —
      </span>
    );
  }
  const label = formatLastRunLabel(usage.lastRunAt);
  return (
    <span className="text-text-secondary whitespace-nowrap text-sm" aria-label={`Last run for ${agentName}: ${label}`}>
      {label}
    </span>
  );
}

function UsageField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-text-secondary text-xs uppercase tracking-wide">{label}</span>
      {children}
    </div>
  );
}

export type AgentLibraryUsageCellsProps = {
  usage?: AgentLibraryUsageStats;
  loading: boolean;
  agentName: string;
  showMetrics: boolean;
  showLastRun: boolean;
};

/** Mobile card usage block. Desktop rows place the same cells in table columns. */
export function AgentLibraryUsageCells({
  usage,
  loading,
  agentName,
  showMetrics,
  showLastRun,
}: AgentLibraryUsageCellsProps) {
  if (!showMetrics && !showLastRun) return null;
  if (!showMetrics) {
    return (
      <UsageField label="Last run">
        <AgentLastRunCell usage={usage} loading={loading} agentName={agentName} />
      </UsageField>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 text-sm">
      <UsageField label={agentLibraryUsageLabels.sessions}>
        <AgentSessionsCell usage={usage} loading={loading} agentName={agentName} />
      </UsageField>
      <UsageField label={agentLibraryUsageLabels.spend}>
        <AgentSpendCell usage={usage} loading={loading} agentName={agentName} />
      </UsageField>
      <UsageField label={agentLibraryUsageLabels.daily}>
        <AgentLibrarySparklineCell points={usage?.dailyPoints} loading={loading} agentName={agentName} />
      </UsageField>
      {showLastRun ? (
        <UsageField label="Last run">
          <AgentLastRunCell usage={usage} loading={loading} agentName={agentName} />
        </UsageField>
      ) : null}
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentLibraryUsageCells: typeof AgentLibraryUsageCells;
  }
}
