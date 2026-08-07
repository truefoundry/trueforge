import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Configuration } from 'openid-client';
import { ID_TOKEN_COOKIE } from './cookies';

/**
 * Session auth failure message. Browser clients redirect to OIDC login only when
 * a 401 body carries this exact `error.message` (not other 401s, e.g. MCP tools).
 */
export const USER_LOGIN_REQUIRED_MESSAGE = 'user_login_required';

/** Signature / exp / iss / aud checks for the OIDC id_token cookie. */
export async function verifyIdToken(params: {
  token: string;
  jwks: JWTVerifyGetKey;
  issuer: string;
  audience: string;
}): Promise<void> {
  await jwtVerify(params.token, params.jwks, {
    issuer: params.issuer,
    audience: params.audience,
  });
}

/**
 * When OIDC is configured, require a cryptographically valid `id_token` cookie.
 * Register this only on protected routes (public routes are mounted above it).
 * No-op when `oidcClient` is undefined (standalone / no IdP).
 */
export function createRequireAuthMiddleware(params: { oidcClient: Configuration | undefined }): MiddlewareHandler {
  if (!params.oidcClient) {
    return async (_c, next) => next();
  }

  const metadata = params.oidcClient.serverMetadata();
  const jwksUri = metadata.jwks_uri;
  if (!jwksUri) {
    throw new Error('OIDC discovery did not return jwks_uri; cannot verify ID tokens');
  }

  const jwks = createRemoteJWKSet(new URL(jwksUri));
  const issuer = metadata.issuer;
  const audience = params.oidcClient.clientMetadata().client_id;

  return async (c, next) => {
    const token = getCookie(c, ID_TOKEN_COOKIE);
    if (!token) {
      throw new HTTPException(401, { message: USER_LOGIN_REQUIRED_MESSAGE });
    }

    try {
      await verifyIdToken({ token, jwks, issuer, audience });
    } catch {
      throw new HTTPException(401, { message: USER_LOGIN_REQUIRED_MESSAGE });
    }

    return next();
  };
}
