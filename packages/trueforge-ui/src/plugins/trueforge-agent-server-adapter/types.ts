import type { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type { AgentSpec } from '../../server/types.js';

/** Catalog attach key may sit on `id`; wire Skill is name-only. See builder getSkills. */
export type HarnessSkillMount = TrueForgeApi.Skill & { id?: string };
export type HarnessMcpServerMount = TrueForgeApi.McpServer;

export interface HarnessAgentSpec
  extends
    AgentSpec<TrueForgeApi.Model, HarnessSkillMount, HarnessMcpServerMount, TrueForgeApi.RuntimeConfig>,
    Omit<TrueForgeApi.AgentSpec, 'skills'> {}
