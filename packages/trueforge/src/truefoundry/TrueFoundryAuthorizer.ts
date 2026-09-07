import { HTTPException } from 'hono/http-exception';

import type { AgentAction, AgentListAccess, Authorizer } from '../auth/authorizer';
import type { RequestContext } from '../auth/identity';
import type { AgentRecord } from '../db/agentStore';
import type { AgentPermission, TrueFoundryServiceFoundryServerClient } from './TrueFoundryServiceFoundryServerClient';

function allowsAction(permissions: readonly AgentPermission[], action: AgentAction): boolean {
  return action === 'manage'
    ? permissions.includes('MANAGE_AGENT')
    : permissions.includes('READ_AGENT') || permissions.includes('MANAGE_AGENT');
}

function requireUserCredential(context: RequestContext): string {
  if (context.user_credential === null) {
    throw new HTTPException(401, { message: 'Authentication token required for agent authorization' });
  }
  return context.user_credential;
}

export class TrueFoundryAuthorizer implements Authorizer {
  readonly #client: TrueFoundryServiceFoundryServerClient;

  constructor(client: TrueFoundryServiceFoundryServerClient) {
    this.#client = client;
  }

  async listAgentAccess(input: { context: RequestContext; action: AgentAction }): Promise<AgentListAccess> {
    const permissions = await this.#client.getAgentPermissions({
      accessToken: requireUserCredential(input.context),
    });
    return {
      kind: 'agent_external_ids',
      agent_external_ids: Object.entries(permissions)
        .filter(([, granted]) => allowsAction(granted, input.action))
        .map(([externalId]) => externalId),
    };
  }

  async canAccessAgent(input: { context: RequestContext; action: AgentAction; agent: AgentRecord }): Promise<boolean> {
    if (input.agent.external_id === null) {
      return false;
    }
    const permissions = await this.#client.getAgentPermissions({
      accessToken: requireUserCredential(input.context),
      externalIds: [input.agent.external_id],
    });
    return allowsAction(permissions[input.agent.external_id] ?? [], input.action);
  }
}
