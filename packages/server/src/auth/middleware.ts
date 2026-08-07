import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { jwtVerify } from 'jose';
import { toUserContext, type IdTokenClaims, type UserContext } from './claims';
import { ID_TOKEN_COOKIE } from './cookies';
import { getOidcVerify } from './oidc';

/** Used when OIDC is not configured (standalone / no IdP). */
export const DEFAULT_USER_CONTEXT: UserContext = {
  userRef: 'default',
  role: 'user',
};

declare module 'hono' {
  interface ContextVariableMap {
    user?: UserContext;
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

  const token = getCookie(c, ID_TOKEN_COOKIE);
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

/** Set `c.var.user` and continue, or throw 401. Without OIDC, sets {@link DEFAULT_USER_CONTEXT}. */
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  if (!getOidcVerify()) {
    c.set('user', DEFAULT_USER_CONTEXT);
    return next();
  }

  try {
    const user = await resolveAuthUser(c);
    if (!user) {
      throw new HTTPException(401, { message: 'Authentication required' });
    }
    c.set('user', user);
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    // Valid JWT but claim mapping failed (e.g. missing user reference claim).
    throw new HTTPException(401, { message: 'Authentication required', cause: error });
  }
  return next();
};
