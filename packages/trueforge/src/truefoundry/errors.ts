import { HTTPException } from 'hono/http-exception';
import type { AgentRecord } from '../db/agentStore';
import { RequestErrorResponseSchema } from '../schemas/errors';

export const AGENT_EXTERNAL_ID_REQUIRED = 'Agent is missing a TrueFoundry external id';
export const TRUEFOUNDRY_MANAGED_STATUS = 424 as const;
export const TRUEFOUNDRY_MANAGED_MESSAGE = 'This resource is managed by TrueFoundry';

/** Require the remote identity needed for TrueFoundry agent operations. */
export function requireTrueFoundryAgentExternalId(agent: Pick<AgentRecord, 'external_id'>): string {
  if (agent.external_id === null) {
    throw new HTTPException(500, { message: AGENT_EXTERNAL_ID_REQUIRED });
  }
  return agent.external_id;
}

/** Reject writes to resources whose lifecycle is owned by TrueFoundry. */
export function trueFoundryManaged(): never {
  throw new HTTPException(TRUEFOUNDRY_MANAGED_STATUS, { message: TRUEFOUNDRY_MANAGED_MESSAGE });
}

export const trueFoundryManagedResponse = {
  content: { 'application/json': { schema: RequestErrorResponseSchema } },
  description: 'Resource is managed by TrueFoundry (`TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL` is set).',
} as const;
