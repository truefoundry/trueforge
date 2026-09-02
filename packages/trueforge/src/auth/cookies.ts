import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Logger } from 'winston';
import { z } from 'zod';
import { getPublicBaseUrl } from '../config';

export const OAUTH_STATE_COOKIE = 'oauth_state';
export const ID_TOKEN_COOKIE = 'id_token';
export const ACCESS_TOKEN_COOKIE = 'accessToken';

const OAuthStateSchema = z.object({
  state: z.string(),
  code_verifier: z.string(),
  return_to: z.string(),
});

export type OAuthState = z.infer<typeof OAuthStateSchema>;

function getAuthCookieAttributes(): {
  httpOnly: boolean;
  sameSite: 'Lax' | 'Strict' | 'None';
  secure: boolean;
  path: string;
} {
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    secure: getPublicBaseUrl().startsWith('https://'),
    path: '/',
  };
}

export function setAuthCookie(params: { context: Context; name: string; value: string; maxAgeSeconds: number }): void {
  setCookie(params.context, params.name, params.value, {
    ...getAuthCookieAttributes(),
    maxAge: params.maxAgeSeconds,
  });
}

export function readOAuthStateCookie(params: { context: Context; logger: Logger }): OAuthState | undefined {
  const raw = getCookie(params.context, OAUTH_STATE_COOKIE);
  if (!raw) {
    return undefined;
  }
  try {
    // JSON.parse throws SyntaxError when the cookie value is not JSON.
    const result = OAuthStateSchema.safeParse(JSON.parse(raw));
    if (!result.success) {
      params.logger.warn('oauth_state cookie failed schema validation', { error: result.error.message });
      return undefined;
    }
    return result.data;
  } catch (error) {
    params.logger.warn('oauth_state cookie is not valid JSON', {
      error: error instanceof Error ? error.message : error,
    });
    return undefined;
  }
}

export function clearAuthCookie(params: { context: Context; name: string }): void {
  deleteCookie(params.context, params.name, getAuthCookieAttributes());
}

export function readIdTokenCookie(params: { context: Context }): string | undefined {
  return getCookie(params.context, ID_TOKEN_COOKIE);
}

export function readAccessTokenCookie(params: { context: Context }): string | undefined {
  return getCookie(params.context, ACCESS_TOKEN_COOKIE);
}
