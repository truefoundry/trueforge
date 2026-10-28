'use client';

import { keepPreviousData, useQueries } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useServerQueryClient } from '../../server/queryClient.js';
import { queryKeys } from '../../server/queryKeys.js';
import { useOptionalAgentMetricsServer, useOptionalAgentSessionsServer } from '../../server/ServerContext.js';
import type { AgentMetricChartData, AgentMetricMeter, AgentMetricPoint } from '../../server/types.js';
import { DEFAULT_SESSION_TIME_WINDOW_MS } from '../../utils/sessionShareUrl.js';

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;
/** Daily cost series length. Meters use the session time window below. */
export const AGENT_LIBRARY_SPARKLINE_DAYS = 14;
/** Day count of `DEFAULT_SESSION_TIME_WINDOW_MS`, which the library meters query uses. */
export const AGENT_LIBRARY_METERS_WINDOW_DAYS = DEFAULT_SESSION_TIME_WINDOW_MS / MS_PER_DAY;
const SPARKLINE_WINDOW_MS = AGENT_LIBRARY_SPARKLINE_DAYS * MS_PER_DAY;
const CHART_NAME = 'sessions_cost_over_time';

export type AgentLibraryDailyPoint = {
  timestamp: string;
  value: number;
};

export type AgentLibraryUsageStats = {
  totalSessions: number | null;
  totalCostUsd: number | null;
  costPerSessionUsd: number | null;
  dailyPoints: AgentLibraryDailyPoint[] | null;
  /**
   * Present only after `listSessions` succeeds. `null` means the agent has no
   * sessions; omitted when the fetch failed (distinct from "never ran").
   */
  lastRunAt?: string | null;
};

function meterValue(meters: readonly AgentMetricMeter[], name: string): number | null {
  const match = meters.find(meter => meter.name === name);
  return match == null || !Number.isFinite(match.aggregateValue) ? null : match.aggregateValue;
}

function chartPoints(points: readonly AgentMetricPoint[] | undefined): AgentLibraryDailyPoint[] | null {
  if (points == null) return null;
  return points.map(point => ({
    timestamp: point.timestamp,
    value: Number.isFinite(point.value) ? point.value : 0,
  }));
}

type UsageQueries = {
  meters: { data: AgentMetricMeter[] | undefined; isError: boolean; isPending: boolean } | undefined;
  chart: { data: AgentMetricChartData | undefined; isError: boolean; isPending: boolean } | undefined;
  lastRun: { data: string | null | undefined; isError: boolean; isPending: boolean } | undefined;
};

/** `undefined` until every enabled request for the agent settles, so each row paints once. */
function usageFromQueries({ meters, chart, lastRun }: UsageQueries): AgentLibraryUsageStats | undefined {
  if (meters?.isPending === true || chart?.isPending === true || lastRun?.isPending === true) return undefined;
  const meterRows = meters?.data;
  const lastRunAt = lastRun?.data;
  return {
    totalSessions: meterRows == null ? null : meterValue(meterRows, 'total_sessions'),
    totalCostUsd: meterRows == null ? null : meterValue(meterRows, 'total_cost_in_usd'),
    costPerSessionUsd: meterRows == null ? null : meterValue(meterRows, 'cost_per_session_in_usd'),
    dailyPoints: chart?.data == null ? null : chartPoints(chart.data.graphs[0]?.graphLines[0]?.values),
    // `undefined` = sessions server absent or the call failed; `null` = no sessions.
    ...(lastRun == null || lastRun.isError || lastRunAt === undefined ? {} : { lastRunAt }),
  };
}

function requireServer<T>(server: T | null): T {
  if (server == null) throw new Error('Usage stats require a server port.');
  return server;
}

/** Rolling windows end on a minute boundary so reopening the library within a minute reuses cached stats. */
function usageWindow(): { metersStart: string; sparklineStart: string; end: string } {
  const now = Math.floor(Date.now() / MS_PER_MINUTE) * MS_PER_MINUTE;
  return {
    metersStart: new Date(now - DEFAULT_SESSION_TIME_WINDOW_MS).toISOString(),
    sparklineStart: new Date(now - SPARKLINE_WINDOW_MS).toISOString(),
    end: new Date(now).toISOString(),
  };
}

/**
 * Loads per-agent spend/session meters, a 14d cost sparkline, and last-run
 * for the visible library page. Each agent paints as its own requests finish.
 * ponytail: three requests per agent (N+1). Replace with one batched metrics
 * call if the library page grows past a few dozen rows.
 */
export function useAgentLibraryUsageStats({
  agentIds,
  refreshKey,
}: {
  agentIds: readonly string[];
  refreshKey: number;
}): {
  usageByAgentId: Map<string, AgentLibraryUsageStats>;
  metricsEnabled: boolean;
  lastRunEnabled: boolean;
} {
  const metrics = useOptionalAgentMetricsServer();
  const sessions = useOptionalAgentSessionsServer();
  const queryClient = useServerQueryClient();
  const metricsEnabled = metrics != null;
  const lastRunEnabled = sessions != null;
  const [range, setRange] = useState(usageWindow);
  const ids = useMemo(() => [...new Set(agentIds)], [agentIds]);

  const metersQueries = useQueries(
    {
      queries: ids.map(agentId => {
        const request = { agentId, startTimestamp: range.metersStart, endTimestamp: range.end };
        return {
          queryKey: queryKeys.metrics.meters(request),
          queryFn: () => requireServer(metrics).getMeters(request),
          enabled: metricsEnabled,
          placeholderData: keepPreviousData,
        };
      }),
    },
    queryClient,
  );
  const chartQueries = useQueries(
    {
      queries: ids.map(agentId => {
        const request = {
          agentId,
          startTimestamp: range.sparklineStart,
          endTimestamp: range.end,
          chartName: CHART_NAME,
        };
        return {
          queryKey: queryKeys.metrics.chartData(request),
          queryFn: () => requireServer(metrics).getChartData(request),
          enabled: metricsEnabled,
          placeholderData: keepPreviousData,
        };
      }),
    },
    queryClient,
  );
  const lastRunQueries = useQueries(
    {
      queries: ids.map(agentId => ({
        queryKey: queryKeys.sessions.lastRun(agentId),
        queryFn: async () => {
          const page = await requireServer(sessions).listSessions({ agentId, limit: 1, order: 'desc' });
          return page.data[0]?.lastActivityAt ?? null;
        },
        enabled: lastRunEnabled,
      })),
    },
    queryClient,
  );

  // The library bumps refreshKey after agent changes; move the window up to now, keeping rows'
  // previous numbers until the new window loads.
  const lastRefreshKeyRef = useRef(refreshKey);
  useEffect(() => {
    if (lastRefreshKeyRef.current === refreshKey) return;
    lastRefreshKeyRef.current = refreshKey;
    setRange(usageWindow());
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.lists() });
  }, [queryClient, refreshKey]);

  const usageByAgentId = new Map<string, AgentLibraryUsageStats>();
  if (metricsEnabled || lastRunEnabled) {
    ids.forEach((agentId, index) => {
      const usage = usageFromQueries({
        meters: metricsEnabled ? metersQueries[index] : undefined,
        chart: metricsEnabled ? chartQueries[index] : undefined,
        lastRun: lastRunEnabled ? lastRunQueries[index] : undefined,
      });
      if (usage != null) usageByAgentId.set(agentId, usage);
    });
  }

  return { usageByAgentId, metricsEnabled, lastRunEnabled };
}
