import { describe, expect, it } from 'vitest';

import { isSettingsChromeEnabled } from '@/server/settingsChrome.js';
import { createMockCatalog } from './mockServer.js';

describe('isSettingsChromeEnabled', () => {
  const catalog = createMockCatalog();

  it('requires a catalog and treats missing settings capability as enabled', () => {
    expect(isSettingsChromeEnabled({ catalog: null, capabilities: null })).toBe(false);
    expect(isSettingsChromeEnabled({ catalog, capabilities: null })).toBe(true);
    expect(
      isSettingsChromeEnabled({
        catalog,
        capabilities: { settings: { enabled: true } },
      }),
    ).toBe(true);
  });

  it('is false when settings capability is disabled', () => {
    expect(
      isSettingsChromeEnabled({
        catalog,
        capabilities: { settings: { enabled: false } },
      }),
    ).toBe(false);
  });
});
