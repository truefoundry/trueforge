import { AgentSkillsHeaderActionSlot, DEFAULT_PLATFORM_SKILLS_URL } from '@truefoundry/trueforge-ui';

import { apiPath } from './publicPath';

/** Host override for `AgentSkillsHeaderActionSlot`. */
export function RegisterSkillsLink(
  props: {
    /** Site-root platform registry (not under TrueForge PUBLIC_BASE_URL). */
    platformSkillsUrl?: string;
    /** TrueForge settings path including PUBLIC_BASE_URL prefix. */
    settingsSkillsUrl?: string;
  } = {},
) {
  return (
    <AgentSkillsHeaderActionSlot
      platformSkillsUrl={props.platformSkillsUrl ?? DEFAULT_PLATFORM_SKILLS_URL}
      settingsSkillsUrl={props.settingsSkillsUrl ?? apiPath('/settings')}
    />
  );
}
