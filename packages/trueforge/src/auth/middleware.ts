import type { Context, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { jwtVerify } from 'jose';
import { toUserContext, type IdTokenClaims } from './claims';
import { readAccessTokenCookie, readIdTokenCookie } from './cookies';
import { LOCAL_USER_CONTEXT, isAdmin, type UserContext } from './identity';
import { getOidcVerify } from './oidc';

declare module 'hono' {
  interface ContextVariableMap {
    user_context?: UserContext;
  }
}

const AUTH_HEADER_TYPE = 'Bearer';

/**
 * Bearer token from `Authorization: Bearer <token>` when present.
 * Case-insensitive scheme; rejects empty credentials. Non-Bearer schemes → undefined
 * so cookie auth can still apply.
 */
export function readBearerToken(c: Context): string | undefined {
  const header = c.req.header('Authorization')?.trim();
  if (!header) {
    return undefined;
  }
  const prefix = `${AUTH_HEADER_TYPE} `;
  if (!header.toLowerCase().startsWith(prefix.toLowerCase())) {
    return undefined;
  }
  const token = header.slice(prefix.length).trim();
  return token.length > 0 ? token : undefined;
}

export function readAccessToken(c: Context): string | undefined {
  return readBearerToken(c) ?? readAccessTokenCookie({ context: c }) ?? readIdTokenCookie({ context: c });
}

export function requireAccessToken(c: Context): string {
  const token = readAccessToken(c);
  if (!token) {
    throw new HTTPException(401, {
      message: 'Authentication token required to list or call TrueFoundry models and MCP servers',
    });
  }
  return token;
}

/**
 * Prefer Bearer over the browser cookie when both are sent (explicit API auth wins).
 */
export function readIdToken(c: Context): string | undefined {
  return readBearerToken(c) ?? readIdTokenCookie({ context: c });
}

/**
 * Bearer or cookie ID token → {@link UserContext} when auth is enabled and the JWT is valid.
 * Missing/invalid JWT → `undefined`. Claim mapping failures after a successful verify rethrow.
 */
export async function resolveAuthUser(c: Context): Promise<UserContext | undefined> {
  const oidcVerify = getOidcVerify();
  if (!oidcVerify) {
    return undefined;
  }

  const token = readIdToken(c);
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

/** Set `c.var.user` and continue, or throw 401. When auth is disabled, sets {@link LOCAL_USER_CONTEXT}. */
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

/** Admin gate: local admin when auth is disabled; when auth is enabled requires an authenticated admin. */
export const adminAuthMiddleware: MiddlewareHandler = async (c, next) => {
  if (!getOidcVerify()) {
    c.set('user_context', LOCAL_USER_CONTEXT);
    return next();
  }

  try {
    const user = await resolveAuthUser(c);
    if (!user) {
      throw new HTTPException(401, { message: 'Authentication required' });
    }
    if (!isAdmin(user)) {
      throw new HTTPException(403, { message: 'Admin access required' });
    }
    c.set('user_context', user);
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(401, { message: 'Authentication required', cause: error });
  }

  return next();
};
