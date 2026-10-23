'use client';

import { Icon } from '../../icons/Icon.js';
import { useOptionalResolvedRoutes } from '../../routing/ResolvedRoutesContext.js';
import {
  useOptionalCatalogServer,
  useServerCapabilities,
  useServerCapabilitiesSettled,
} from '../../server/ServerContext.js';
import { useOptionalShellMode } from '../../server/ShellModeContext.js';
import { isSettingsChromeEnabled } from '../../server/serverChrome.js';
import { Button } from '../primitives/Button.js';
import { resolveSettingsSkillsUrl } from './resolveSkillsNavigationUrls.js';
import { DEFAULT_PLATFORM_SKILLS_URL, DEFAULT_SETTINGS_SKILLS_URL } from './skillsNavigationDefaults.js';

export { DEFAULT_PLATFORM_SKILLS_URL, DEFAULT_SETTINGS_SKILLS_URL } from './skillsNavigationDefaults.js';

export type AgentSkillsHeaderActionSlotProps = {
  /**
   * External skills registry at the **site origin**.
   * Not prefixed with TrueForge `routes.basename`. Pass `""` to omit.
   */
  platformSkillsUrl?: string;
  /** Settings fallback when shell context is missing; default is basename-aware via router. */
  settingsSkillsUrl?: string;
};

function canRegisterViaSettings({
  catalog,
  capabilities,
}: {
  catalog: ReturnType<typeof useOptionalCatalogServer>;
  capabilities: ReturnType<typeof useServerCapabilities>;
}): boolean {
  return isSettingsChromeEnabled({ catalog, capabilities }) && catalog?.skillCatalog != null;
}

function hasPlatformSkillsDestination(platformSkillsUrl: string): boolean {
  return platformSkillsUrl.length > 0;
}

/**
 * Host chrome to the right of the Skills modal title. Waits for capabilities
 * before rendering; hides when neither settings skills nor a platform URL apply.
 */
export function AgentSkillsHeaderActionSlot({
  platformSkillsUrl = DEFAULT_PLATFORM_SKILLS_URL,
  settingsSkillsUrl = DEFAULT_SETTINGS_SKILLS_URL,
}: AgentSkillsHeaderActionSlotProps = {}) {
  const catalog = useOptionalCatalogServer();
  const capabilities = useServerCapabilities();
  const capabilitiesSettled = useServerCapabilitiesSettled();
  const shell = useOptionalShellMode();
  const routes = useOptionalResolvedRoutes();
  const settingsHref = resolveSettingsSkillsUrl({ settingsSkillsUrl, routes });

  if (!capabilitiesSettled) {
    return null;
  }

  const registerViaSettings = canRegisterViaSettings({ catalog, capabilities });
  const registerViaPlatform = hasPlatformSkillsDestination(platformSkillsUrl);

  if (!registerViaSettings && !registerViaPlatform) {
    return null;
  }

  return (
    <Button.Ghost
      type="button"
      size="small"
      className="ml-1 shrink-0"
      title="Register Skills"
      onClick={() => {
        if (canRegisterViaSettings({ catalog, capabilities })) {
          if (shell != null) {
            shell.setSettingsOpen(true, 'skills');
            return;
          }
          window.location.assign(settingsHref);
          return;
        }
        if (hasPlatformSkillsDestination(platformSkillsUrl)) {
          window.location.assign(platformSkillsUrl);
        }
      }}
    >
      Register Skills
      <Icon name="external-link" className="size-3 shrink-0" />
    </Button.Ghost>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentSkillsHeaderActionSlot: typeof AgentSkillsHeaderActionSlot;
  }
}
