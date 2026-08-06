import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import configuration from '../config';
import { ID_TOKEN_COOKIE, OAUTH_STATE_COOKIE, OAUTH_STATE_MAX_AGE_SECONDS } from './constants';

const OAuthStateSchema = z.object({
  state: z.string(),
  code_verifier: z.string(),
  return_to: z.string(),
});

export type OAuthState = z.infer<typeof OAuthStateSchema>;

function cookieOptions(): {
  httpOnly: boolean;
  sameSite: 'Lax';
  secure: boolean;
  path: string;
} {
  return {
    httpOnly: true,
    sameSite: 'Lax',
    // need a decision here, should need if we want to test the flow for dev purpose
    secure: configuration.PUBLIC_BASE_URL.startsWith('https://'),
    path: '/',
  };
}

export function setOAuthStateCookie(c: Context, value: OAuthState): void {
  setCookie(c, OAUTH_STATE_COOKIE, JSON.stringify(value), {
    ...cookieOptions(),
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  });
}

export function readOAuthStateCookie(c: Context): OAuthState | undefined {
  const raw = getCookie(c, OAUTH_STATE_COOKIE);
  if (!raw) {
    return undefined;
  }
  try {
    const result = OAuthStateSchema.safeParse(JSON.parse(raw));
    if (!result.success) {
      return undefined;
    }
    return result.data;
  } catch {
    return undefined;
  }
}

export function clearOAuthStateCookie(c: Context): void {
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: '/' });
}

export function setIdTokenCookie(c: Context, idToken: string, maxAgeSeconds: number): void {
  setCookie(c, ID_TOKEN_COOKIE, idToken, {
    ...cookieOptions(),
    maxAge: maxAgeSeconds,
  });
}

export function readIdTokenCookie(c: Context): string | undefined {
  return getCookie(c, ID_TOKEN_COOKIE);
}

export function clearIdTokenCookie(c: Context): void {
  deleteCookie(c, ID_TOKEN_COOKIE, { path: '/' });
}
