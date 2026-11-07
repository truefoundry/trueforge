import { buildPath } from '../../routing/paths.js';
import type { ResolvedRoutes } from '../../routing/types.js';
import { DEFAULT_SETTINGS_SKILLS_URL } from './skillsNavigationDefaults.js';

/** Settings fallback path including router `basename` when the host still uses SDK defaults. */
export function resolveSettingsSkillsUrl({
  settingsSkillsUrl,
  routes,
}: {
  settingsSkillsUrl: string;
  routes: ResolvedRoutes | null;
}): string {
  if (settingsSkillsUrl !== DEFAULT_SETTINGS_SKILLS_URL || routes == null) {
    return settingsSkillsUrl;
  }
  const settingsPath = buildPath({ type: 'settings' }, routes);
  if (settingsPath == null) {
    return settingsSkillsUrl;
  }
  const basename = routes.basename.endsWith('/') ? routes.basename.slice(0, -1) : routes.basename;
  return `${basename}${settingsPath}` || settingsPath;
}
