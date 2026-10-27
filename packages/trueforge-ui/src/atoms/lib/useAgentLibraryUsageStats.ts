'use client';

import { useEffect, useRef, useState } from 'react';

import { useOptionalAgentMetricsServer, useOptionalAgentSessionsServer } from '../../server/ServerContext.js';
import type {
  AgentMetricMeter,
  AgentMetricPoint,
  AgentMetricsServer,
  AgentSessionsServer,
} from '../../server/types.js';
import { DEFAULT_SESSION_TIME_WINDOW_MS } from '../../utils/sessionShareUrl.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
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

function unavailableUsage(): AgentLibraryUsageStats {
  return {
    totalSessions: null,
    totalCostUsd: null,
    costPerSessionUsd: null,
    dailyPoints: null,
  };
}

async function loadUsageForAgent({
  agentId,
  metrics,
  sessions,
  metersStart,
  metersEnd,
  sparklineStart,
  sparklineEnd,
}: {
  agentId: string;
  metrics: AgentMetricsServer | null;
  sessions: AgentSessionsServer | null;
  metersStart: string;
  metersEnd: string;
  sparklineStart: string;
  sparklineEnd: string;
}): Promise<AgentLibraryUsageStats> {
  const metersPromise =
    metrics == null
      ? Promise.resolve({ ok: false as const })
      : metrics
          .getMeters({
            agentId,
            startTimestamp: metersStart,
            endTimestamp: metersEnd,
          })
          .then(
            meters => ({ ok: true as const, meters }),
            () => ({ ok: false as const }),
          );

  const chartPromise =
    metrics == null
      ? Promise.resolve({ ok: false as const })
      : metrics
          .getChartData({
            agentId,
            startTimestamp: sparklineStart,
            endTimestamp: sparklineEnd,
            chartName: CHART_NAME,
          })
          .then(
            data => ({ ok: true as const, data }),
            () => ({ ok: false as const }),
          );

  // `undefined` = sessions server absent or the call failed; `null` = no sessions.
  const lastRunPromise: Promise<string | null | undefined> =
    sessions == null
      ? Promise.resolve(undefined)
      : sessions.listSessions({ agentId, limit: 1, order: 'desc' }).then(
          page => page.data[0]?.lastActivityAt ?? null,
          () => undefined,
        );

  const [metersResult, chartResult, lastRunAt] = await Promise.all([metersPromise, chartPromise, lastRunPromise]);

  const meters = metersResult.ok ? metersResult.meters : [];
  const dailyPoints = chartResult.ok ? chartPoints(chartResult.data.graphs[0]?.graphLines[0]?.values) : null;

  return {
    totalSessions: metersResult.ok ? meterValue(meters, 'total_sessions') : null,
    totalCostUsd: metersResult.ok ? meterValue(meters, 'total_cost_in_usd') : null,
    costPerSessionUsd: metersResult.ok ? meterValue(meters, 'cost_per_session_in_usd') : null,
    dailyPoints,
    ...(lastRunAt === undefined ? {} : { lastRunAt }),
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
  const metricsEnabled = metrics != null;
  const lastRunEnabled = sessions != null;
  const [usageByAgentId, setUsageByAgentId] = useState<Map<string, AgentLibraryUsageStats>>(() => new Map());
  const agentIdsKey = agentIds.join('\0');
  const loadedIdsKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const ids = agentIdsKey.length === 0 ? [] : agentIdsKey.split('\0');
    if (ids.length === 0 || (metrics == null && sessions == null)) {
      loadedIdsKeyRef.current = agentIdsKey;
      setUsageByAgentId(prev => (prev.size === 0 ? prev : new Map()));
      return;
    }

    // Keep the previous page's numbers across a refresh so rows don't flash
    // skeletons. A new id set has nothing worth keeping.
    if (loadedIdsKeyRef.current !== agentIdsKey) {
      loadedIdsKeyRef.current = agentIdsKey;
      setUsageByAgentId(prev => (prev.size === 0 ? prev : new Map()));
    }

    let cancelled = false;
    const now = Date.now();
    const metersEnd = new Date(now).toISOString();
    const metersStart = new Date(now - DEFAULT_SESSION_TIME_WINDOW_MS).toISOString();
    const sparklineStart = new Date(now - SPARKLINE_WINDOW_MS).toISOString();

    for (const agentId of ids) {
      void loadUsageForAgent({
        agentId,
        metrics,
        sessions,
        metersStart,
        metersEnd,
        sparklineStart,
        sparklineEnd: metersEnd,
      })
        .then(stats => {
          if (cancelled) return;
          setUsageByAgentId(prev => {
            const next = new Map(prev);
            next.set(agentId, stats);
            return next;
          });
        })
        .catch(() => {
          if (cancelled) return;
          setUsageByAgentId(prev => {
            const next = new Map(prev);
            next.set(agentId, unavailableUsage());
            return next;
          });
        });
    }

    return () => {
      cancelled = true;
    };
  }, [agentIdsKey, metrics, refreshKey, sessions]);

  return { usageByAgentId, metricsEnabled, lastRunEnabled };
}
