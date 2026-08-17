import type { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type { AgentSpec } from '../../server/types.js';

export type HarnessSkillMount = TrueForgeApi.SkillNameRef;
export type HarnessMcpServerMount = TrueForgeApi.McpServer;

export interface HarnessAgentSpec extends AgentSpec<
  TrueForgeApi.AgentSpecModel,
  HarnessSkillMount,
  HarnessMcpServerMount
> {
  config?: TrueForgeApi.RuntimeConfig;
  instructions?: string;
  messages?: TrueForgeApi.AgentSpecUserMessage[];
  responseFormat?: TrueForgeApi.ResponseFormat;
}
