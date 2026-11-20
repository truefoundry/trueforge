import { describe, expect, it } from 'vitest';

import * as serverChrome from '@/server/serverChrome.js';
import * as settingsChrome from '@/server/settingsChrome.js';

/** The deprecated path stays a pass-through, so gate behaviour is asserted once in serverChrome. */
describe('settingsChrome', () => {
  it('forwards every chrome gate to serverChrome', () => {
    expect(settingsChrome.isSettingsChromeEnabled).toBe(serverChrome.isSettingsChromeEnabled);
    expect(settingsChrome.isSessionsChromeEnabled).toBe(serverChrome.isSessionsChromeEnabled);
    expect(settingsChrome.isSchedulesChromeEnabled).toBe(serverChrome.isSchedulesChromeEnabled);
    expect(settingsChrome.isMetricsChromeEnabled).toBe(serverChrome.isMetricsChromeEnabled);
    expect(settingsChrome.toEffectiveRoutes).toBe(serverChrome.toEffectiveRoutes);
  });
});
