import { describe, expect, it } from 'vitest';

import { resolveSettingsSkillsUrl } from '@/atoms/draft/resolveSkillsNavigationUrls.js';
import { DEFAULT_SETTINGS_SKILLS_URL } from '@/atoms/draft/skillsNavigationDefaults.js';
import { resolveRoutesConfig } from '@/routing/paths.js';

describe('resolveSettingsSkillsUrl', () => {
  it('prefixes the default settings path with router basename', () => {
    const routes = resolveRoutesConfig({ basename: '/trueforge' });
    expect(
      resolveSettingsSkillsUrl({
        settingsSkillsUrl: DEFAULT_SETTINGS_SKILLS_URL,
        routes,
      }),
    ).toBe('/trueforge/settings');
  });

  it('leaves a host-provided settings URL unchanged', () => {
    const routes = resolveRoutesConfig({ basename: '/trueforge' });
    expect(
      resolveSettingsSkillsUrl({
        settingsSkillsUrl: '/custom/settings',
        routes,
      }),
    ).toBe('/custom/settings');
  });
});
