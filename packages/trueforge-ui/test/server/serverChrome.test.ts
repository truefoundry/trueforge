import { describe, expect, it } from 'vitest';

import { resolveRoutesConfig } from '@/routing/paths.js';
import {
  isEnvironmentsChromeEnabled,
  isMetricsChromeEnabled,
  isSchedulesChromeEnabled,
  isSessionsChromeEnabled,
  isSettingsChromeEnabled,
  toEffectiveRoutes,
} from '@/server/serverChrome.js';
import {
  createMockAgentMetricsServer,
  createMockAgentSessionsServer,
  createMockCatalog,
  createMockSandboxEnvironmentServer,
  createMockScheduleServer,
} from './mockServer.js';

describe('serverChrome', () => {
  const catalog = createMockCatalog();
  const sessions = createMockAgentSessionsServer();
  const schedules = createMockScheduleServer();
  const sandboxEnvironments = createMockSandboxEnvironmentServer();
  const metrics = createMockAgentMetricsServer();
  const routes = resolveRoutesConfig();

  it('isSettingsChromeEnabled requires a catalog and explicit capability', () => {
    expect(isSettingsChromeEnabled({ catalog: null, capabilities: null })).toBe(false);
    expect(isSettingsChromeEnabled({ catalog, capabilities: null })).toBe(false);
    expect(isSettingsChromeEnabled({ catalog, capabilities: {} })).toBe(false);
    expect(
      isSettingsChromeEnabled({
        catalog,
        capabilities: { settings: { enabled: true } },
      }),
    ).toBe(true);
    expect(
      isSettingsChromeEnabled({
        catalog,
        capabilities: { settings: { enabled: false } },
      }),
    ).toBe(false);
  });

  it('gates sessions / schedules / environments / metrics on port presence', () => {
    expect(isSessionsChromeEnabled({ sessions: null })).toBe(false);
    expect(isSessionsChromeEnabled({ sessions })).toBe(true);
    expect(isSchedulesChromeEnabled({ schedules: null })).toBe(false);
    expect(isSchedulesChromeEnabled({ schedules })).toBe(true);
    expect(isEnvironmentsChromeEnabled({ sandboxEnvironments: null })).toBe(false);
    expect(isEnvironmentsChromeEnabled({ sandboxEnvironments })).toBe(true);
    expect(isMetricsChromeEnabled({ metrics: null })).toBe(false);
    expect(isMetricsChromeEnabled({ metrics })).toBe(true);
  });

  it('toEffectiveRoutes nulls path-backed places when ports are missing', () => {
    const disabled = toEffectiveRoutes({
      routes,
      catalog: null,
      capabilities: null,
      sessions: null,
      schedules: null,
      sandboxEnvironments: null,
    });
    expect(disabled.settings).toBeNull();
    expect(disabled.sessionsBrowser).toBeNull();
    expect(disabled.sharedSession).toBeNull();
    expect(disabled.libraryAgent).toBeNull();
    expect(disabled.schedules).toBeNull();
    expect(disabled.environments).toBeNull();
    expect(disabled.root).toBe('/');
    expect(disabled.library).toBe('/library');

    const enabled = toEffectiveRoutes({
      routes,
      catalog,
      capabilities: { settings: { enabled: true } },
      sessions,
      schedules,
      sandboxEnvironments,
    });
    expect(enabled.settings).toBe('/settings');
    expect(enabled.sessionsBrowser).toBe('/sessions');
    expect(enabled.sharedSession).toBe('/sessions/share/:sessionId');
    expect(enabled.libraryAgent).toBe('/library/:agentId');
    expect(enabled.schedules).toBe('/schedules');
    expect(enabled.environments).toBe('/environments');
  });
});
