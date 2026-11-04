import { HTTPException } from 'hono/http-exception';

import {
  type AgentAction,
  type AgentListAccess,
  type Authorizer,
  type GetPermissionsInput,
  resolveSandboxEnvironmentPermissions,
  resolveSchedulePermissions,
} from '../auth/authorizer';
import { canCreateOrEdit, type RequestContext } from '../auth/identity';
import type { AgentRecord } from '../db/agentStore';
import type { ListPermissionsData, ResourcePermission } from '../schemas/permissions';
import {
  emptyPermissionsByResourceId,
  listPermissionsData,
  SESSION_OWNER_PERMISSIONS,
  TENANT_CREATE_AGENT_PERMISSIONS,
  TENANT_CREATE_SANDBOX_ENVIRONMENT_PERMISSIONS,
} from '../schemas/permissions';
import type { AgentPermission, TrueFoundryServiceFoundryServerClient } from './TrueFoundryServiceFoundryServerClient';

const permissionByAction: Record<AgentAction, AgentPermission> = {
  read: 'READ_AGENT',
  use: 'USE_AGENT',
  manage: 'MANAGE_AGENT',
  delete: 'DELETE_AGENT',
};

const resourcePermissionByAgentPermission = {
  USE_AGENT: 'USE',
  MANAGE_AGENT: 'MANAGE',
  DELETE_AGENT: 'DELETE',
} as const satisfies Partial<Record<AgentPermission, ResourcePermission>>;

const mappableAgentPermissions = ['USE_AGENT', 'MANAGE_AGENT', 'DELETE_AGENT'] as const;

function allowsAction(permissions: readonly AgentPermission[], action: AgentAction): boolean {
  return permissions.includes(permissionByAction[action]);
}

function toResourcePermissions(permissions: readonly AgentPermission[]): ResourcePermission[] {
  return mappableAgentPermissions
    .filter(agentPermission => permissions.includes(agentPermission))
    .map(agentPermission => resourcePermissionByAgentPermission[agentPermission]);
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

  async getPermissions(input: GetPermissionsInput): Promise<ListPermissionsData> {
    const { requestContext, resourceIds } = input;

    if (input.resourceType === 'tenant') {
      const tenantPermissions = await this.#client.getTenantPermissions({
        accessToken: requireUserCredential(requestContext),
      });
      const agent = tenantPermissions.includes('CREATE_AGENT') ? [...TENANT_CREATE_AGENT_PERMISSIONS] : [];
      const sandbox_environment = canCreateOrEdit(requestContext)
        ? [...TENANT_CREATE_SANDBOX_ENVIRONMENT_PERMISSIONS]
        : [];
      return listPermissionsData('tenant', { agent, sandbox_environment });
    }

    const data = emptyPermissionsByResourceId(resourceIds);

    if (input.resourceType === 'agent') {
      const agents = await input.store.getExternalIdsByIds({
        tenant_id: requestContext.tenant_id,
        ids: resourceIds,
      });
      if (agents.length === 0) {
        return listPermissionsData('agent', data);
      }
      const permissions = await this.#client.getAgentPermissions({
        accessToken: requireUserCredential(requestContext),
        externalIds: agents.map(agent => agent.external_id),
      });
      for (const agent of agents) {
        data[agent.id] = toResourcePermissions(permissions[agent.external_id] ?? []);
      }
      return listPermissionsData('agent', data);
    }

    if (input.resourceType === 'schedule') {
      return resolveSchedulePermissions(input);
    }

    if (input.resourceType === 'sandbox_environment') {
      return resolveSandboxEnvironmentPermissions(input);
    }

    const ownedIds = await input.store.getOwnedIds({
      tenant_id: requestContext.tenant_id,
      ids: resourceIds,
      subject_id: requestContext.subject.id,
    });
    for (const id of ownedIds) {
      data[id] = [...SESSION_OWNER_PERMISSIONS];
    }
    return listPermissionsData('session', data);
  }
}
