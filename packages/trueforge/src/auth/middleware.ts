import type { Context, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { jwtVerify } from 'jose';

import type { Authenticator } from './authenticator';
import { toRequestContext, type IdTokenClaims } from './claims';
import { hasAdminRole, type RequestContext } from './identity';
import { getOidcVerify } from './oidc';
import { extractRequestToken, readBearerToken } from './token';

export { extractRequestToken, readBearerToken };

export function createAuthMiddleware(authenticator: Authenticator): MiddlewareHandler {
  return async (c, next) => {
    const requestContext = await tryAuthenticate({ authenticator, context: c });
    if (requestContext === undefined) {
      throw new HTTPException(401, { message: 'Authentication required' });
    }
    c.set('request_context', requestContext);
    return next();
  };
}

export function createAdminAuthMiddleware(authenticator: Authenticator): MiddlewareHandler {
  return async (c, next) => {
    const requestContext = await tryAuthenticate({ authenticator, context: c });
    if (requestContext === undefined) {
      throw new HTTPException(401, { message: 'Authentication required' });
    }
    if (!hasAdminRole(requestContext)) {
      throw new HTTPException(403, { message: 'Admin access required' });
    }
    c.set('request_context', requestContext);
    return next();
  };
}

/** Bearer API-key gate for service-only routes. */
export function createApiKeyAuthMiddleware(apiKey: string): MiddlewareHandler {
  return async (c, next) => {
    const token = readBearerToken(c);
    if (token === undefined || token !== apiKey) {
      throw new HTTPException(401, { message: 'Invalid service credential' });
    }
    return next();
  };
}

/**
 * Soft OIDC probe for login/callback — not request-gate middleware.
 *
 * Same JWT → {@link RequestContext} path as {@link OidcAuthenticator}, but missing/invalid
 * tokens return `undefined` instead of throwing 401 (claim mapping failures after verify still
 * rethrow so callers can clear a stale cookie). Needed where "no session yet" must not fail
 * the request, e.g. redirect-if-already-authenticated on `/auth/callback`.
 */
export async function resolveOidcRequestContext(c: Context): Promise<RequestContext | undefined> {
  const oidcVerify = getOidcVerify();
  if (!oidcVerify) {
    return undefined;
  }

  const token = extractRequestToken(c);
  if (!token) {
    return undefined;
  }

  let payload: Awaited<ReturnType<typeof jwtVerify>>['payload'];
  try {
    ({ payload } = await jwtVerify(token, oidcVerify.jwks, {
      issuer: oidcVerify.issuer,
      audience: oidcVerify.audience,
    }));
  } catch {
    return undefined;
  }

  const claims: IdTokenClaims = { ...payload };
  return toRequestContext({
    claims,
    config: oidcVerify.oidcConfig,
    user_credential: token,
  });
}

/**
 * Soft authenticate — missing/invalid credentials (`401`) return `undefined` instead of throwing.
 * Other failures (e.g. ServiceFoundry outage → 500) are rethrown.
 */
export async function tryAuthenticate(params: {
  authenticator: Authenticator;
  context: Context;
}): Promise<RequestContext | undefined> {
  try {
    return await params.authenticator.authenticate(params.context);
  } catch (error) {
    if (error instanceof HTTPException && error.status === 401) {
      return undefined;
    }
    throw error;
  }
}
