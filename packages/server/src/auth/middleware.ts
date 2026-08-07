import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Configuration } from 'openid-client';
import type { OIDCConfig } from '../config';
import { toUserContext, type IdTokenClaims } from './claims';
import { ID_TOKEN_COOKIE } from './cookies';

/** Exact message the browser client uses to trigger OIDC login redirect. */
export const USER_LOGIN_REQUIRED_MESSAGE = 'user_login_required';

export interface AuthUser {
  /** Stable caller identity — value of the configured OIDC_USER_REFERENCE_CLAIM. */
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

interface OidcVerify {
  jwks: JWTVerifyGetKey;
  issuer: string;
  audience: string;
  oidcConfig: OIDCConfig;
}

/** Set by {@link enableOidcAuth} / cleared by {@link disableOidcAuth}. */
let oidcVerify: OidcVerify | null = null;

/** Enable cookie JWT verification using the IdP client + claim-mapping config from `initOidc`. */
export function enableOidcAuth(params: { client: Configuration; oidcConfig: OIDCConfig }): void {
  const metadata = params.client.serverMetadata();
  if (!metadata.jwks_uri) {
    throw new Error('OIDC discovery did not return jwks_uri; cannot verify ID tokens');
  }

  oidcVerify = {
    jwks: createRemoteJWKSet(new URL(metadata.jwks_uri)),
    issuer: metadata.issuer,
    audience: params.client.clientMetadata().client_id,
    oidcConfig: params.oidcConfig,
  };
}

/** Disable OIDC cookie auth (no IdP / standalone). Protected routes use {@link DEFAULT_AUTH_USER}. */
export function disableOidcAuth(): void {
  oidcVerify = null;
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
    const claims: IdTokenClaims = { ...payload };
    const { userRef, role } = toUserContext(claims, oidcVerify.oidcConfig);
    return { email: userRef, role };
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
