import type { ResolvedRoutes } from '../routing/types.js';
import type {
  AgentMetricsServer,
  AgentSessionsServer,
  CatalogServer,
  SandboxEnvironmentServer,
  ScheduleServer,
  SettingsCapability,
} from './types.js';

/**
 * Whether Settings chrome is available: sidebar button and `/settings` route.
 * Matches the gate in {@link ShellActions}.
 */
export function isSettingsChromeEnabled({
  catalog,
  capabilities,
}: {
  catalog: CatalogServer | null | undefined;
  capabilities: { settings?: SettingsCapability } | null | undefined;
}): boolean {
  // Absent capabilities mean "still loading", so wait rather than flash Settings
  // open and shut. Loaded capabilities that omit `settings` are an older host.
  return catalog != null && capabilities != null && hasAnySettingsSectionEnabled(capabilities.settings);
}

const SETTINGS_SECTIONS = [
  'modelProviders',
  'mcpServers',
  'skills',
  'sandboxProviders',
  'webSearch',
  'memoryProviders',
] as const satisfies readonly (keyof SettingsCapability)[];

/**
 * Settings chrome is worth showing until every section is closed. Counting the
 * sections the host never reported keeps this agreeing with
 * {@link isSettingsSectionEnabled}, which treats those as open.
 */
export function hasAnySettingsSectionEnabled(settings: SettingsCapability | undefined): boolean {
  return SETTINGS_SECTIONS.some(section => isSettingsSectionEnabled({ settings, section }));
}

/** A section the host never reported stays open, so older hosts keep working. */
export function isSettingsSectionEnabled({
  settings,
  section,
}: {
  settings: SettingsCapability | undefined;
  section: keyof SettingsCapability;
}): boolean {
  return settings?.[section]?.enabled !== false;
}

/** Sessions browser + agent-detail surfaces (Overview / sessions / code). */
export function isSessionsChromeEnabled({ sessions }: { sessions: AgentSessionsServer | null | undefined }): boolean {
  return sessions != null;
}

/** Schedules page + library schedules column. */
export function isSchedulesChromeEnabled({ schedules }: { schedules: ScheduleServer | null | undefined }): boolean {
  return schedules != null;
}

/** Environments page (sandbox environments CRUD). */
export function isEnvironmentsChromeEnabled({
  sandboxEnvironments,
  capabilities,
}: {
  sandboxEnvironments: SandboxEnvironmentServer | null | undefined;
  capabilities: { sandbox?: { environments?: { enabled?: boolean } } } | null | undefined;
}): boolean {
  // Require an explicit capabilities.sandbox.environments.enabled=true (same pattern as settings).
  return sandboxEnvironments != null && capabilities?.sandbox?.environments?.enabled === true;
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
  sandboxEnvironments,
}: {
  routes: ResolvedRoutes;
  catalog: CatalogServer | null | undefined;
  capabilities:
    | {
        settings?: SettingsCapability;
        sandbox?: { environments?: { enabled?: boolean } };
      }
    | null
    | undefined;
  sessions: AgentSessionsServer | null | undefined;
  schedules: ScheduleServer | null | undefined;
  sandboxEnvironments: SandboxEnvironmentServer | null | undefined;
}): ResolvedRoutes {
  const sessionsEnabled = isSessionsChromeEnabled({ sessions });
  return {
    ...routes,
    settings: isSettingsChromeEnabled({ catalog, capabilities }) ? routes.settings : null,
    sessionsBrowser: sessionsEnabled ? routes.sessionsBrowser : null,
    sharedSession: sessionsEnabled ? routes.sharedSession : null,
    libraryAgent: sessionsEnabled ? routes.libraryAgent : null,
    schedules: isSchedulesChromeEnabled({ schedules }) ? routes.schedules : null,
    environments: isEnvironmentsChromeEnabled({ sandboxEnvironments, capabilities }) ? routes.environments : null,
  };
}
