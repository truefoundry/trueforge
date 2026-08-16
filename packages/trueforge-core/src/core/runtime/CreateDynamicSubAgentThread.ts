import type { AgentInfo, AgentParent } from '../events/schema';
import type { AgentDefinition } from './AgentDefinition';
import type { AgentThread } from './AgentThread';

export type CreateDynamicSubAgentThread = (input: {
  parentDefinition: AgentDefinition;
  request: AgentInfo;
  threadId: string;
  parent: AgentParent;
  signal: AbortSignal;
}) => Promise<AgentThread>;
