import type { SettingsCapability } from '@/server/types.js';

/** Every settings section sharing one value, for tests that only gate on settings chrome. */
export function allSettingsSections(enabled: boolean): SettingsCapability {
  const section = { enabled, manageProviders: enabled };
  return {
    modelProviders: section,
    mcpServers: section,
    skills: section,
    sandboxProviders: section,
    webSearch: section,
    memory: section,
  };
}
