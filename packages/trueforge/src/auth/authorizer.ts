import type { ISessionStore } from '@truefoundry/trueforge-core/agent-session';
import type { AgentRecord, IAgentStore } from '../db/agentStore';
import type { IScheduleStore } from '../db/scheduleStore';
import {
  emptyPermissionsByResourceId,
  OWNER_RESOURCE_PERMISSIONS,
  type ResourcePermission,
} from '../schemas/permissions';
import type { RequestContext } from './identity';

export type AgentAction = 'read' | 'manage';

export type AgentListAccess = { kind: 'all' } | { kind: 'agent_external_ids'; agent_external_ids: readonly string[] };

interface GetPermissionsBase {
  requestContext: RequestContext;
  resourceIds: readonly string[];
}

export type GetPermissionsInput =
  | (GetPermissionsBase & { resourceType: 'agent'; store: IAgentStore })
  | (GetPermissionsBase & { resourceType: 'schedule'; store: IScheduleStore })
  | (GetPermissionsBase & { resourceType: 'session'; store: ISessionStore });

export interface Authorizer {
  listAgentAccess(input: { context: RequestContext; action: AgentAction }): Promise<AgentListAccess>;
  canAccessAgent(input: { context: RequestContext; action: AgentAction; agent: AgentRecord }): Promise<boolean>;
  getPermissions(input: GetPermissionsInput): Promise<Record<string, ResourcePermission[]>>;
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

  async getPermissions(input: GetPermissionsInput): Promise<Record<string, ResourcePermission[]>> {
    const ownedIds = await input.store.getOwnedIds({
      tenant_id: input.requestContext.tenant_id,
      ids: input.resourceIds,
      subject_id: input.requestContext.subject.id,
    });
    const data = emptyPermissionsByResourceId(input.resourceIds);
    for (const id of ownedIds) {
      data[id] = [...OWNER_RESOURCE_PERMISSIONS];
    }
    return data;
  }
}
