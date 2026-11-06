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
import { canCreateOrEdit, canEditSchedule, hasAdminRole, type RequestContext } from './identity';

export type AgentAction = 'read' | 'use' | 'manage' | 'delete';

export type AgentListAccess =
  | { kind: 'all' }
  | { kind: 'agent_external_ids'; agent_external_ids: readonly string[] }
  | { kind: 'agent_names'; agent_names: readonly string[] };

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
  /** Whether the caller may create agents and schedules or run unsaved (inline) agents. */
  canAuthorWork(input: { context: RequestContext }): Promise<boolean>;
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

function tenantCreatePermissions({
  requestContext,
  restricted,
}: {
  requestContext: RequestContext;
  restricted: boolean;
}): ListPermissionsData {
  return listPermissionsData('tenant', {
    agent: restricted ? [] : [...TENANT_CREATE_AGENT_PERMISSIONS],
    sandbox_environment:
      !restricted && canCreateOrEdit(requestContext) ? [...TENANT_CREATE_SANDBOX_ENVIRONMENT_PERMISSIONS] : [],
  });
}

export interface TrueForgeAuthorizerOptions {
  /** Role value that confines non-admin callers to `restrictedAgentNames`; undefined disables the feature. */
  restrictedRoleValue?: string | undefined;
  restrictedAgentNames?: readonly string[] | undefined;
}

export class TrueForgeAuthorizer implements Authorizer {
  readonly #restrictedRoleValue: string | undefined;
  readonly #restrictedAgentNames: readonly string[];

  constructor(options: TrueForgeAuthorizerOptions = {}) {
    this.#restrictedRoleValue = options.restrictedRoleValue === '' ? undefined : options.restrictedRoleValue;
    this.#restrictedAgentNames = options.restrictedAgentNames ?? [];
  }

  /** Admin always wins over the restricted role. */
  #isRestricted(context: RequestContext): boolean {
    return (
      this.#restrictedRoleValue !== undefined &&
      context.roles.includes(this.#restrictedRoleValue) &&
      !hasAdminRole(context)
    );
  }

  listAgentAccess(input: { context: RequestContext; action: AgentAction }): Promise<AgentListAccess> {
    if (!this.#isRestricted(input.context)) {
      return Promise.resolve({ kind: 'all' });
    }
    if (input.action === 'read' || input.action === 'use') {
      return Promise.resolve({ kind: 'agent_names', agent_names: this.#restrictedAgentNames });
    }
    // Restricted callers never gain manage rights through the allowlist.
    return Promise.resolve({ kind: 'agent_external_ids', agent_external_ids: [] });
  }

  canAccessAgent(input: { context: RequestContext; action: AgentAction; agent: AgentRecord }): Promise<boolean> {
    if (input.action === 'read' || input.action === 'use') {
      return Promise.resolve(
        !this.#isRestricted(input.context) || this.#restrictedAgentNames.includes(input.agent.name),
      );
    }
    return Promise.resolve(input.agent.created_by_subject.subject_id === input.context.subject.id);
  }

  canAuthorWork(input: { context: RequestContext }): Promise<boolean> {
    return Promise.resolve(!this.#isRestricted(input.context));
  }

  async getPermissions(input: GetPermissionsInput): Promise<ListPermissionsData> {
    if (input.resourceType === 'tenant') {
      return tenantCreatePermissions({
        requestContext: input.requestContext,
        restricted: this.#isRestricted(input.requestContext),
      });
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
