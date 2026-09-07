import type { AgentRecord } from '../db/agentStore';
import type { RequestContext } from './identity';

export type AgentAction = 'read' | 'manage';

export type AgentListAccess = { kind: 'all' } | { kind: 'agent_external_ids'; agent_external_ids: readonly string[] };

export interface Authorizer {
  listAgentAccess(input: { context: RequestContext; action: AgentAction }): Promise<AgentListAccess>;
  canAccessAgent(input: { context: RequestContext; action: AgentAction; agent: AgentRecord }): Promise<boolean>;
}

/** Standalone and OIDC: tenant-local agents. Read is unconstrained; manage is creator-only. */
export class TrueForgeAuthorizer implements Authorizer {
  listAgentAccess(): Promise<AgentListAccess> {
    return Promise.resolve({ kind: 'all' });
  }

  canAccessAgent(input: { context: RequestContext; action: AgentAction; agent: AgentRecord }): Promise<boolean> {
    if (input.action === 'read') {
      return Promise.resolve(true);
    }
    return Promise.resolve(input.agent.created_by_subject.subject_id === input.context.subject.id);
  }
}
