import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import configuration from '../config';

export const OAUTH_STATE_COOKIE = 'oauth_state';
export const ID_TOKEN_COOKIE = 'id_token';

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

export function setAuthCookie(options: { context: Context; name: string; value: string; maxAgeSeconds: number }): void {
  setCookie(options.context, options.name, options.value, {
    ...cookieOptions(),
    maxAge: options.maxAgeSeconds,
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

export function clearAuthCookie(options: { context: Context; name: string }): void {
  deleteCookie(options.context, options.name, { path: '/' });
}
