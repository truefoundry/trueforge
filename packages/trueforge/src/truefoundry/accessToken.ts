import { HTTPException } from 'hono/http-exception';
import type { RequestContext } from '../auth/identity';
import type { AgentRecord } from '../db/agentStore';
import type { TrueFoundryServiceFoundryServerClient } from './TrueFoundryServiceFoundryServerClient';

/**
 * Token for one TrueFoundry call. Resolved on first use and reused for later calls on the same
 * callable.
 */
export type ResolveAccessToken = () => Promise<string>;

type AgentTokenVendor = Pick<TrueFoundryServiceFoundryServerClient, 'vendToken'>;

const AGENT_EXTERNAL_ID_REQUIRED = 'Agent is missing a TrueFoundry external id';

/** Per-request map of saved-agent vends; not exported so only this module can read it. */
const accessTokenCache: unique symbol = Symbol('truefoundryAccessTokenCache');

/**
 * Request context produced only in TrueFoundry auth. The cache lives on this object for the
 * lifetime of one HTTP request; a later request gets a new context and vends again.
 */
export type TrueFoundryRequestContext = RequestContext & {
  readonly [accessTokenCache]: Map<string, ResolveAccessToken>;
};

export function createTrueFoundryRequestContext(base: RequestContext): TrueFoundryRequestContext {
  return { ...base, [accessTokenCache]: new Map() };
}

function isTrueFoundryRequestContext(context: RequestContext): context is TrueFoundryRequestContext {
  return accessTokenCache in context;
}

export function asTrueFoundryRequestContext(context: RequestContext): TrueFoundryRequestContext {
  if (!isTrueFoundryRequestContext(context)) {
    throw new Error('TrueFoundry request context required for access token resolution');
  }
  return context;
}

/**
 * Token scoped to a saved agent, for work the agent does on the caller's behalf.
 * Throws 500 up front when the agent was never registered with TrueFoundry.
 */
export function agentAccessToken(input: {
  client: AgentTokenVendor;
  context: RequestContext;
  agent: AgentRecord;
}): ResolveAccessToken {
  const { client, context } = input;
  const agentId = input.agent.external_id;
  if (agentId === null) {
    throw new HTTPException(500, { message: AGENT_EXTERNAL_ID_REQUIRED });
  }
  let pending: Promise<string> | undefined;
  return () => {
    pending ??= client
      .vendToken({ subject: context.subject, agentId, tenantName: context.tenant_id })
      .catch((error: unknown) => {
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

/**
 * Token for a TrueFoundry request, optionally scoped to the saved agent executing a turn.
 * Saved-agent callables are stored on this request's context so model and MCP stores share one vend.
 */
export function accessTokenForRequest(input: {
  client: AgentTokenVendor;
  context: TrueFoundryRequestContext;
  agent: AgentRecord | undefined;
}): ResolveAccessToken {
  if (input.agent === undefined) {
    return callerAccessToken(input.context);
  }
  const agentId = input.agent.external_id;
  if (agentId === null) {
    throw new HTTPException(500, { message: AGENT_EXTERNAL_ID_REQUIRED });
  }
  const cache = input.context[accessTokenCache];
  const existing = cache.get(agentId);
  if (existing !== undefined) {
    return existing;
  }
  const resolve = agentAccessToken({ client: input.client, context: input.context, agent: input.agent });
  cache.set(agentId, resolve);
  return resolve;
}
