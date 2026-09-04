import { HTTPException } from 'hono/http-exception';

import type { AgentRecord } from '../db/agentStore';
import type {
  AgentPermission,
  TrueFoundryServiceFoundryServerClient,
} from '../truefoundry/TrueFoundryServiceFoundryServerClient';
import { hasAdminRole, type RequestContext } from './identity';

export type AgentAction = 'read' | 'manage';

export type ExternalAgentListAccess =
  { kind: 'all' } | { kind: 'owner' } | { kind: 'agent_external_ids'; agent_external_ids: readonly string[] };

export interface ExternalAuthorizer {
  listAgentAccess(input: { context: RequestContext; action: AgentAction }): Promise<ExternalAgentListAccess>;
  canAccessAgent(input: { context: RequestContext; action: AgentAction; agent: AgentRecord }): Promise<boolean>;
}

export class AllowAllExternalAuthorizer implements ExternalAuthorizer {
  listAgentAccess(): Promise<ExternalAgentListAccess> {
    return Promise.resolve({ kind: 'all' });
  }

  canAccessAgent(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

export class OidcExternalAuthorizer implements ExternalAuthorizer {
  listAgentAccess(input: { context: RequestContext; action: AgentAction }): Promise<ExternalAgentListAccess> {
    if (input.action === 'read' && hasAdminRole(input.context)) {
      return Promise.resolve({ kind: 'all' });
    }
    return Promise.resolve({ kind: 'owner' });
  }

  canAccessAgent(input: { context: RequestContext; action: AgentAction; agent: AgentRecord }): Promise<boolean> {
    if (input.action === 'read' && hasAdminRole(input.context)) {
      return Promise.resolve(true);
    }
    return Promise.resolve(input.agent.created_by_subject.subject_id === input.context.subject.id);
  }
}

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

export class TrueFoundryExternalAuthorizer implements ExternalAuthorizer {
  readonly #client: TrueFoundryServiceFoundryServerClient;

  constructor(client: TrueFoundryServiceFoundryServerClient) {
    this.#client = client;
  }

  async listAgentAccess(input: { context: RequestContext; action: AgentAction }): Promise<ExternalAgentListAccess> {
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
