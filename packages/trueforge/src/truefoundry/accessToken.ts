import { HTTPException } from 'hono/http-exception';
import type { RequestContext } from '../auth/identity';
import type { AgentRecord } from '../db/agentStore';
import type { TrueFoundryServiceFoundryServerClient } from './TrueFoundryServiceFoundryServerClient';

/**
 * Token for one TrueFoundry call. Resolved on first use and reused for later calls on the same
 * callable, so one turn vends once.
 */
export type ResolveAccessToken = () => Promise<string>;

type AgentTokenVendor = Pick<TrueFoundryServiceFoundryServerClient, 'vendToken'>;

const AGENT_EXTERNAL_ID_REQUIRED = 'Agent is missing a TrueFoundry external id';

/**
 * Token scoped to a saved agent, for work the agent does on the caller's behalf.
 * Throws 422 up front when the agent was never registered with TrueFoundry.
 */
export function agentAccessToken(input: {
  client: AgentTokenVendor;
  tenantName: string;
  subject: RequestContext['subject'];
  agent: AgentRecord;
}): ResolveAccessToken {
  const { client, tenantName, subject } = input;
  const agentId = input.agent.external_id;
  if (agentId === null) {
    throw new HTTPException(422, { message: AGENT_EXTERNAL_ID_REQUIRED });
  }
  let pending: Promise<string> | undefined;
  return () => {
    pending ??= client.vendToken({ subject, agentId, tenantName }).catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}

/** Token of whoever made the request. */
export function callerAccessToken(context: RequestContext): ResolveAccessToken {
  if (context.user_credential === null) {
    throw new HTTPException(401, {
      message: 'Authentication token required to list or call TrueFoundry models, MCP servers, and agents',
    });
  }
  const token = context.user_credential;
  return () => Promise.resolve(token);
}
