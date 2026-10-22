import { HTTPException } from 'hono/http-exception';
import type { Logger } from 'winston';
import type { RequestContext } from '../auth/identity';
import type { AgentRecord } from '../db/agentStore';
import { requireTrueFoundryAgentExternalId } from './errors';
import type { TrueFoundryServiceFoundryServerClient, VendedTokens } from './TrueFoundryServiceFoundryServerClient';

/** Token for one TrueFoundry call. Resolved on first use and reused for later calls on the same callable. */
export type ResolveServiceFoundryAuthorization = () => Promise<string>;
export type ResolveGatewayAuthorization = () => Promise<GatewayAuthorization>;
export const ACTOR_AUTHORIZATION_HEADER = 'x-tfy-actor-authorization';

/**
 * Model gateway and MCP gateway invoke authorization.
 * - caller — unsaved agent; authorization is the live caller token
 * - delegated — saved agent with a caller token; actorAuthorization is vend actorToken
 * - exchanged — saved agent with no caller token; authorization is vend subjectToken
 */
export type AuthorizationType = 'caller' | 'delegated' | 'exchanged';

export interface GatewayAuthorization {
  type: AuthorizationType;
  subjectToken: string;
  /** Set only for delegated. Do not send with exchanged: the subject token already carries the actor. */
  actorAgentToken?: string;
}

export interface TrueFoundryAccess {
  /** ServiceFoundry list/get. Saved agent: vend actorToken. Otherwise the caller token. */
  resolveServiceFoundryAuthorization: ResolveServiceFoundryAuthorization;
  resolveGatewayAuthorization: ResolveGatewayAuthorization;
}

type AgentTokenVendor = Pick<TrueFoundryServiceFoundryServerClient, 'vendToken'>;

/** Per-request map of saved-agent vends; not exported so only this module can read it. */
const accessTokenCache: unique symbol = Symbol('truefoundryAccessTokenCache');

/**
 * Request context produced only in TrueFoundry auth. The cache lives on this object for the
 * lifetime of one HTTP request; a later request gets a new context and vends again.
 */
export type TrueFoundryRequestContext = RequestContext & {
  readonly [accessTokenCache]: Map<string, TrueFoundryAccess>;
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

function callerAccess(context: RequestContext): TrueFoundryAccess {
  const resolve = callerAccessToken(context);
  return {
    resolveServiceFoundryAuthorization: resolve,
    resolveGatewayAuthorization: async () => ({ type: 'caller', subjectToken: await resolve() }),
  };
}

/**
 * Saved-agent authorization. Vends once.
 * Caller token present → delegated. Absent → exchanged (schedule creator on the subject).
 * Throws 500 up front when the agent was never registered with TrueFoundry.
 */
export function savedAgentAccess(input: {
  client: AgentTokenVendor;
  requestContext: Pick<RequestContext, 'tenant_id' | 'subject' | 'user_credential'>;
  agent: AgentRecord;
  logger: Pick<Logger, 'info'>;
}): TrueFoundryAccess {
  const { client, requestContext: context } = input;
  const agentId = requireTrueFoundryAgentExternalId(input.agent);
  const callerAuthorization = context.user_credential;
  let pending: Promise<VendedTokens> | undefined;

  const vendToken = (): Promise<VendedTokens> => {
    if (pending === undefined) {
      input.logger.info('Exchanging user context for agent access token', {
        subject: context.subject.id,
        agentId,
      });
      pending = client
        .vendToken({ subject: context.subject, agentId, tenantName: context.tenant_id })
        .catch((error: unknown) => {
          pending = undefined;
          throw error;
        });
    }
    return pending;
  };

  return {
    resolveServiceFoundryAuthorization: async () => {
      const vendTokenResult = await vendToken();
      return vendTokenResult.actorToken;
    },
    resolveGatewayAuthorization: async () => {
      const vendTokenResult = await vendToken();
      if (callerAuthorization !== null) {
        return {
          type: 'delegated',
          subjectToken: callerAuthorization,
          actorAgentToken: vendTokenResult.actorToken,
        };
      }
      return { type: 'exchanged', subjectToken: vendTokenResult.subjectToken };
    },
  };
}

/** Token of whoever made the request. */
export function callerAccessToken(context: RequestContext): ResolveServiceFoundryAuthorization {
  if (context.user_credential === null) {
    throw new HTTPException(401, {
      message: 'Authentication token required to list or call TrueFoundry models, MCP servers, skills, and agents',
    });
  }
  const token = context.user_credential;
  return () => Promise.resolve(token);
}

/**
 * Access tokens for a TrueFoundry request, optionally scoped to the saved agent executing a turn.
 * Saved-agent callables are stored on this request's context so model and MCP stores share one vend.
 */
export function accessTokenForRequest(input: {
  client: AgentTokenVendor;
  requestContext: TrueFoundryRequestContext;
  agent: AgentRecord | undefined;
  logger: Pick<Logger, 'info'>;
}): TrueFoundryAccess {
  if (input.agent === undefined) {
    return callerAccess(input.requestContext);
  }
  const agentId = requireTrueFoundryAgentExternalId(input.agent);
  const cache = input.requestContext[accessTokenCache];
  const existing = cache.get(agentId);
  if (existing !== undefined) {
    return existing;
  }
  const tokens = savedAgentAccess({
    client: input.client,
    requestContext: input.requestContext,
    agent: input.agent,
    logger: input.logger,
  });
  cache.set(agentId, tokens);
  return tokens;
}

/** Actor header for delegated mode. Empty for caller and exchanged. */
export function actorAuthorizationHeaders(authorization: GatewayAuthorization): Record<string, string> {
  if (authorization.actorAgentToken === undefined) {
    return {};
  }
  return { [ACTOR_AUTHORIZATION_HEADER]: `Bearer ${authorization.actorAgentToken}` };
}

export function gatewayHeaders(authorization: GatewayAuthorization): Record<string, string> {
  return {
    Authorization: `Bearer ${authorization.subjectToken}`,
    ...actorAuthorizationHeaders(authorization),
  };
}
