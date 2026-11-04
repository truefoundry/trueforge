import type { ISessionStore } from '@truefoundry/trueforge-core/agent-session';
import type { AgentRecord, IAgentStore } from '../db/agentStore';
import type { ISandboxEnvironmentStore } from '../db/sandboxEnvironmentStore';
import type { IScheduleStore } from '../db/scheduleStore';
import {
  AGENT_OWNER_PERMISSIONS,
  AGENT_USE_PERMISSIONS,
  emptyPermissionsByResourceId,
  listPermissionsData,
  SANDBOX_ENVIRONMENT_OWNER_PERMISSIONS,
  SCHEDULE_OWNER_PERMISSIONS,
  SESSION_OWNER_PERMISSIONS,
  TENANT_CREATE_AGENT_PERMISSIONS,
  TENANT_CREATE_SANDBOX_ENVIRONMENT_PERMISSIONS,
  type ListPermissionsData,
} from '../schemas/permissions';
import { DEFAULT_SANDBOX_ENVIRONMENT_NAME } from '../schemas/sandboxEnvironment';
import { canCreateOrEdit, canEditSchedule, type RequestContext } from './identity';

export type AgentAction = 'read' | 'use' | 'manage' | 'delete';

export type AgentListAccess = { kind: 'all' } | { kind: 'agent_external_ids'; agent_external_ids: readonly string[] };

interface GetPermissionsBase {
  requestContext: RequestContext;
  resourceIds: readonly string[];
}

export type GetPermissionsInput =
  | (GetPermissionsBase & { resourceType: 'agent'; store: IAgentStore })
  | (GetPermissionsBase & { resourceType: 'schedule'; store: IScheduleStore })
  | (GetPermissionsBase & { resourceType: 'sandbox_environment'; store: ISandboxEnvironmentStore })
  | (GetPermissionsBase & { resourceType: 'session'; store: ISessionStore })
  | (GetPermissionsBase & { resourceType: 'tenant' });

export interface Authorizer {
  listAgentAccess(input: { context: RequestContext; action: AgentAction }): Promise<AgentListAccess>;
  canAccessAgent(input: { context: RequestContext; action: AgentAction; agent: AgentRecord }): Promise<boolean>;
  getPermissions(input: GetPermissionsInput): Promise<ListPermissionsData>;
}

/** Schedule MANAGE/DELETE via {@link canEditSchedule} (admin or creator). */
export async function resolveSchedulePermissions(input: {
  requestContext: RequestContext;
  resourceIds: readonly string[];
  store: IScheduleStore;
}): Promise<ListPermissionsData> {
  const data = emptyPermissionsByResourceId(input.resourceIds);
  // Batch ownership columns only (never full manifest/task) and dedupe ids for the IN list.
  const schedules = await input.store.getSchedulesByIds({
    tenant_id: input.requestContext.tenant_id,
    ids: [...new Set(input.resourceIds)],
  });
  for (const schedule of schedules) {
    if (canEditSchedule(input.requestContext, schedule.created_by_subject.subject_id)) {
      data[schedule.id] = [...SCHEDULE_OWNER_PERMISSIONS];
    }
  }
  return listPermissionsData('schedule', data);
}

/**
 * Sandbox environment MANAGE/DELETE via {@link canCreateOrEdit} (admin or creator).
 * Reserved `"default"` never gets write grants — platform-managed only.
 */
export async function resolveSandboxEnvironmentPermissions(input: {
  requestContext: RequestContext;
  resourceIds: readonly string[];
  store: ISandboxEnvironmentStore;
}): Promise<ListPermissionsData> {
  const data = emptyPermissionsByResourceId(input.resourceIds);
  const environments = await input.store.getEnvironmentsByIds({
    tenant_id: input.requestContext.tenant_id,
    ids: [...new Set(input.resourceIds)],
  });
  for (const environment of environments) {
    if (environment.name === DEFAULT_SANDBOX_ENVIRONMENT_NAME) {
      continue;
    }
    if (canCreateOrEdit(input.requestContext, environment.created_by_subject.subject_id)) {
      data[environment.id] = [...SANDBOX_ENVIRONMENT_OWNER_PERMISSIONS];
    }
  }
  return listPermissionsData('sandbox_environment', data);
}

function tenantCreatePermissions(requestContext: RequestContext): ListPermissionsData {
  return listPermissionsData('tenant', {
    agent: [...TENANT_CREATE_AGENT_PERMISSIONS],
    sandbox_environment: canCreateOrEdit(requestContext) ? [...TENANT_CREATE_SANDBOX_ENVIRONMENT_PERMISSIONS] : [],
  });
}

export class TrueForgeAuthorizer implements Authorizer {
  listAgentAccess(): Promise<AgentListAccess> {
    return Promise.resolve({ kind: 'all' });
  }

  canAccessAgent(input: { context: RequestContext; action: AgentAction; agent: AgentRecord }): Promise<boolean> {
    if (input.action === 'read' || input.action === 'use') {
      return Promise.resolve(true);
    }
    return Promise.resolve(input.agent.created_by_subject.subject_id === input.context.subject.id);
  }

  async getPermissions(input: GetPermissionsInput): Promise<ListPermissionsData> {
    if (input.resourceType === 'tenant') {
      return tenantCreatePermissions(input.requestContext);
    }

    const data = emptyPermissionsByResourceId(input.resourceIds);

    if (input.resourceType === 'agent') {
      const ownedIds = await input.store.getOwnedIds({
        tenant_id: input.requestContext.tenant_id,
        ids: input.resourceIds,
        subject_id: input.requestContext.subject.id,
      });
      const owned = new Set(ownedIds);
      for (const id of input.resourceIds) {
        data[id] = owned.has(id) ? [...AGENT_OWNER_PERMISSIONS] : [...AGENT_USE_PERMISSIONS];
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
      tenant_id: input.requestContext.tenant_id,
      ids: input.resourceIds,
      subject_id: input.requestContext.subject.id,
    });
    for (const id of ownedIds) {
      data[id] = [...SESSION_OWNER_PERMISSIONS];
    }
    return listPermissionsData('session', data);
  }
}
