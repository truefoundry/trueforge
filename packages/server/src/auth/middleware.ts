import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Configuration } from 'openid-client';
import { ID_TOKEN_COOKIE } from './cookies';

/** Exact message the browser client uses to trigger OIDC login redirect. */
export const USER_LOGIN_REQUIRED_MESSAGE = 'user_login_required';

export interface AuthUser {
  email: string;
  role: string;
}

/** Used when OIDC is not configured (standalone / no IdP). */
export const DEFAULT_AUTH_USER: AuthUser = {
  email: 'default',
  role: 'user',
};

declare module 'hono' {
  interface ContextVariableMap {
    user?: AuthUser;
  }
}

type OidcVerify = {
  jwks: JWTVerifyGetKey;
  issuer: string;
  audience: string;
};

/** Populated by {@link configureAuth}; null when browser login is disabled. */
let oidcVerify: OidcVerify | null = null;

/** Call once at boot with the discovered OIDC client (or `undefined`). */
export function configureAuth(oidcClient: Configuration | undefined): void {
  if (!oidcClient) {
    oidcVerify = null;
    return;
  }

  const metadata = oidcClient.serverMetadata();
  if (!metadata.jwks_uri) {
    throw new Error('OIDC discovery did not return jwks_uri; cannot verify ID tokens');
  }

  oidcVerify = {
    jwks: createRemoteJWKSet(new URL(metadata.jwks_uri)),
    issuer: metadata.issuer,
    audience: oidcClient.clientMetadata().client_id,
  };
}

/** Soft cookie → user (missing/invalid/no OIDC → undefined). For public handlers like `/me`. */
export async function resolveAuthUser(c: Context): Promise<AuthUser | undefined> {
  if (!oidcVerify) {
    return undefined;
  }

  const token = getCookie(c, ID_TOKEN_COOKIE);
  if (!token) {
    return undefined;
  }

  try {
    const { payload } = await jwtVerify(token, oidcVerify.jwks, {
      issuer: oidcVerify.issuer,
      audience: oidcVerify.audience,
    });
    const emailClaim = payload['email'];
    if (typeof emailClaim === 'string' && emailClaim !== '') {
      return { email: emailClaim, role: 'user' };
    }
    if (typeof payload.sub === 'string' && payload.sub !== '') {
      return { email: payload.sub, role: 'user' };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Set `c.var.user` and continue, or throw 401. Without OIDC, sets {@link DEFAULT_AUTH_USER}. */
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  if (!oidcVerify) {
    c.set('user', DEFAULT_AUTH_USER);
    return next();
  }

  const user = await resolveAuthUser(c);
  if (!user) {
    throw new HTTPException(401, { message: USER_LOGIN_REQUIRED_MESSAGE });
  }
  c.set('user', user);
  return next();
};
