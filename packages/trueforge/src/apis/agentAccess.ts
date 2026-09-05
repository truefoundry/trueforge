/**
 * Agent store reads narrowed by the authorizer, shared by the agent, session,
 * and schedule handlers. Lives in the API layer because stores must stay free
 * of request identity.
 */
import type { AgentAction, Authorizer } from '../auth/authorizer';
import type { RequestContext } from '../auth/identity';
import type { AgentRecord, IAgentStore } from '../db/agentStore';

/** The agent only when the caller may act on it, so callers answer 404 for missing and forbidden alike. */
export async function agentIfAccessible(input: {
  authorizer: Authorizer;
  context: RequestContext;
  action: AgentAction;
  agent: AgentRecord | undefined;
}): Promise<AgentRecord | undefined> {
  if (input.agent === undefined) {
    return undefined;
  }
  const allowed = await input.authorizer.canAccessAgent({
    context: input.context,
    action: input.action,
    agent: input.agent,
  });
  return allowed ? input.agent : undefined;
}

/** Resolve the authorizer list scope against the agent store without extra store filters. */
export async function listAccessibleAgents<TTransaction>(input: {
  store: IAgentStore<TTransaction>;
  context: RequestContext;
  authorizer: Authorizer;
  action: AgentAction;
}): Promise<AgentRecord[]> {
  const access = await input.authorizer.listAgentAccess({ context: input.context, action: input.action });
  if (access.kind === 'all') {
    return input.store.listAgents({ tenant_id: input.context.tenant_id });
  }
  return input.store.listAgents({
    tenant_id: input.context.tenant_id,
    external_ids: access.agent_external_ids,
  });
}
