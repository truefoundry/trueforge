import type { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type { AgentSpec } from '../../server/types.js';

export type HarnessSkillMount = TrueForgeApi.Skill;
export type HarnessMcpServerMount = TrueForgeApi.McpServer;

export interface HarnessAgentSpec extends AgentSpec<TrueForgeApi.Model, HarnessSkillMount, HarnessMcpServerMount> {
  config?: TrueForgeApi.RuntimeConfig;
  instructions?: string;
  messages?: TrueForgeApi.InitialUserMessage[];
  responseFormat?: TrueForgeApi.ResponseFormat;
}
