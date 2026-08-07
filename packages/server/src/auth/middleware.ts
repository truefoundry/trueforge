import type { Context, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { jwtVerify } from 'jose';
import { toUserContext, type IdTokenClaims } from './claims';
import { readIdTokenCookie } from './cookies';
import { LOCAL_USER_CONTEXT, type UserContext } from './identity';
import { getOidcVerify } from './oidc';

declare module 'hono' {
  interface ContextVariableMap {
    user_context?: UserContext;
  }
}

/**
 * Cookie → {@link UserContext} when OIDC is on and the token is valid.
 * Missing/invalid JWT → `undefined`. Claim mapping failures after a successful verify rethrow.
 */
export async function resolveAuthUser(c: Context): Promise<UserContext | undefined> {
  const oidcVerify = getOidcVerify();
  if (!oidcVerify) {
    return undefined;
  }

  const token = readIdTokenCookie({ context: c });
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
  return toUserContext(claims, oidcVerify.oidcConfig);
}

/** Set `c.var.user` and continue, or throw 401. Without OIDC, sets {@link LOCAL_USER_CONTEXT}. */
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  if (!getOidcVerify()) {
    c.set('user_context', LOCAL_USER_CONTEXT);
    return next();
  }

  try {
    const user = await resolveAuthUser(c);
    if (!user) {
      throw new HTTPException(401, { message: 'Authentication required' });
    }
    c.set('user_context', user);
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    // Valid JWT but claim mapping failed (e.g. missing user reference claim).
    throw new HTTPException(401, { message: 'Authentication required', cause: error });
  }
  return next();
};
