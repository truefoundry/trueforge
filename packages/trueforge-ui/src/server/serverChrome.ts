import type { ResolvedRoutes } from '../routing/types.js';
import type { AgentMetricsServer, AgentSessionsServer, CatalogServer, ScheduleServer } from './types.js';

/**
 * Whether Settings chrome is available: sidebar button and `/settings` route.
 * Matches the gate in {@link ShellActions}.
 */
export function isSettingsChromeEnabled({
  catalog,
  capabilities,
}: {
  catalog: CatalogServer | null | undefined;
  capabilities: { settings?: { enabled?: boolean } } | null | undefined;
}): boolean {
  return catalog != null && capabilities?.settings?.enabled !== false;
}

/** Sessions browser + agent-detail surfaces (Overview / sessions / code). */
export function isSessionsChromeEnabled({ sessions }: { sessions: AgentSessionsServer | null | undefined }): boolean {
  return sessions != null;
}

/** Schedules page + library schedules column. */
export function isSchedulesChromeEnabled({ schedules }: { schedules: ScheduleServer | null | undefined }): boolean {
  return schedules != null;
}

/** Agent-details Metrics tab (no top-level path). */
export function isMetricsChromeEnabled({ metrics }: { metrics: AgentMetricsServer | null | undefined }): boolean {
  return metrics != null;
}

/**
 * Unregister path-backed places whose optional server port is absent.
 * Chrome gates and route gates must stay in lockstep.
 */
export function toEffectiveRoutes({
  routes,
  catalog,
  capabilities,
  sessions,
  schedules,
}: {
  routes: ResolvedRoutes;
  catalog: CatalogServer | null | undefined;
  capabilities: { settings?: { enabled?: boolean } } | null | undefined;
  sessions: AgentSessionsServer | null | undefined;
  schedules: ScheduleServer | null | undefined;
}): ResolvedRoutes {
  const sessionsEnabled = isSessionsChromeEnabled({ sessions });
  return {
    ...routes,
    settings: isSettingsChromeEnabled({ catalog, capabilities }) ? routes.settings : null,
    sessionsBrowser: sessionsEnabled ? routes.sessionsBrowser : null,
    libraryAgent: sessionsEnabled ? routes.libraryAgent : null,
    schedules: isSchedulesChromeEnabled({ schedules }) ? routes.schedules : null,
  };
}
