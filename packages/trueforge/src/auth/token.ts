import type { Context } from 'hono';

import { readAccessTokenCookie, readIdTokenCookie } from './cookies';

const AUTH_HEADER_TYPE = 'Bearer';
const BEARER_PREFIX = `${AUTH_HEADER_TYPE} `;

/**
 * Parse `Bearer <token>` from an Authorization-style value.
 * Case-insensitive scheme; empty credentials → undefined.
 */
function parseBearerAuthorization(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith(BEARER_PREFIX.toLowerCase())) {
    return undefined;
  }
  const token = trimmed.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : undefined;
}

/**
 * Bearer token from `Authorization: Bearer <token>` when present.
 * Non-Bearer schemes → undefined so cookie auth can still apply.
 */
export function readBearerToken(c: Context): string | undefined {
  const header = c.req.header('Authorization');
  if (!header) {
    return undefined;
  }
  return parseBearerAuthorization(header);
}

/**
 * Prefer an explicit Bearer over browser cookies.
 * Cookie order: `accessToken`, then `id_token`.
 * Never log the returned value.
 */
export function extractRequestToken(c: Context): string | undefined {
  return readBearerToken(c) ?? readAccessTokenCookie({ context: c }) ?? readIdTokenCookie({ context: c });
}
