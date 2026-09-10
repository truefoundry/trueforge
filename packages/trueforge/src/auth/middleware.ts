import type { Context, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { jwtVerify } from 'jose';

import configuration from '../config';
import type { Authenticator } from './authenticator';
import { toRequestContext, type IdTokenClaims } from './claims';
import { hasAdminRole, type RequestContext } from './identity';
import { getOidcVerify } from './oidc';
import { extractRequestToken } from './token';

export { extractRequestToken, readBearerToken } from './token';

export function createAuthMiddleware(authenticator: Authenticator): MiddlewareHandler {
  return async (c, next) => {
    c.set('request_context', await authenticator.authenticate(c));
    return next();
  };
}

export function createAdminAuthMiddleware(authenticator: Authenticator): MiddlewareHandler {
  return async (c, next) => {
    const requestContext = await authenticator.authenticate(c);
    if (!hasAdminRole(requestContext)) {
      throw new HTTPException(403, { message: 'Admin access required' });
    }
    c.set('request_context', requestContext);
    return next();
  };
}

/**
 * Service-to-service API key auth for internal import.
 * Sets request_context so resolveAgentStore can build TrueFoundryAgentStore
 * (needs user_credential for ServiceFoundry put/delete). Body supplies tenant_id.
 */
export const truefoundryAdminMiddleware: MiddlewareHandler = async (c, next) => {
  const token = extractRequestToken(c);
  if (configuration.STANDALONE) {
    throw new HTTPException(403, { message: 'Service API key required' });
  }
  const apiKey = configuration.TRUEFOUNDRY_API_KEY;
  if (apiKey === undefined || token === undefined || token !== apiKey) {
    throw new HTTPException(403, { message: 'Service API key required' });
  }
  c.set('request_context', {
    tenant_id: 'system',
    subject: { id: 'tfy-system', type: 'serviceaccount', display_name: 'tfy-system' },
    roles: [],
    user_credential: apiKey,
  });
  return next();
};

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
