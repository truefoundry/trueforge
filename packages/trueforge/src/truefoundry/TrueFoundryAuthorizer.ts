import { HTTPException } from 'hono/http-exception';

import type { AgentAction, AgentListAccess, Authorizer, GetPermissionsInput } from '../auth/authorizer';
import type { RequestContext } from '../auth/identity';
import type { AgentRecord } from '../db/agentStore';
import type { ResourcePermission } from '../schemas/permissions';
import { emptyPermissionsByResourceId, OWNER_RESOURCE_PERMISSIONS } from '../schemas/permissions';
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

  async getPermissions(input: GetPermissionsInput): Promise<Record<string, ResourcePermission[]>> {
    const { requestContext, resourceIds } = input;
    const data = emptyPermissionsByResourceId(resourceIds);

    if (input.resourceType === 'agent') {
      const agents = await input.store.getExternalIdsByIds({
        tenant_id: requestContext.tenant_id,
        ids: resourceIds,
      });
      if (agents.length === 0) {
        return data;
      }
      const permissions = await this.#client.getAgentPermissions({
        accessToken: requireUserCredential(requestContext),
        externalIds: agents.map(agent => agent.external_id),
      });
      for (const agent of agents) {
        if ((permissions[agent.external_id] ?? []).includes('MANAGE_AGENT')) {
          data[agent.id] = [...OWNER_RESOURCE_PERMISSIONS];
        }
      }
      return data;
    }

    const ownedIds = await input.store.getOwnedIds({
      tenant_id: requestContext.tenant_id,
      ids: resourceIds,
      subject_id: requestContext.subject.id,
    });
    for (const id of ownedIds) {
      data[id] = [...OWNER_RESOURCE_PERMISSIONS];
    }
    return data;
  }
}
