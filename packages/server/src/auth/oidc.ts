import type { Context } from 'hono';
import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  type Configuration,
  discovery,
  randomPKCECodeVerifier,
  randomState,
} from 'openid-client';
import configuration, { type OIDCConfig } from '../config';
import { ID_TOKEN_COOKIE, OAUTH_STATE_COOKIE, setAuthCookie } from './cookies';

const CALLBACK_PATH = '/api/v1/auth/callback';
const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;
const ID_TOKEN_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;
// TODO: use dynamic claims/scopes when we add RBAC
const OIDC_SCOPES = 'openid email profile';

/** Discover the IdP once at process startup when OIDC is configured. */
export async function initOidc(oidc: OIDCConfig | undefined): Promise<Configuration | undefined> {
  if (!oidc) {
    return undefined;
  }

  return discovery(new URL(oidc.OIDC_ISSUER_URL), oidc.OIDC_CLIENT_ID, oidc.OIDC_CLIENT_SECRET);
}

function authCallbackUrl(): string {
  return `${configuration.PUBLIC_BASE_URL}${CALLBACK_PATH}`;
}

/**
 * Same-origin relative path only.
 * - starts with `/`
 * - not `//…` (open redirect)
 * - not `/api` or `/api/…`
 */
const SAFE_RETURN_TO = /^\/(?!\/|api(?:\/|$)).*/;

export function safeReturnTo(value: string | undefined): string {
  if (value && SAFE_RETURN_TO.test(value)) {
    return value;
  }
  return '/';
}

export async function buildLoginAuthorization(params: {
  context: Context;
  client: Configuration;
  returnTo: string | undefined;
}): Promise<string> {
  const returnTo = safeReturnTo(params.returnTo);
  const codeVerifier = randomPKCECodeVerifier();
  const state = randomState();
  const authorizationUrl = buildAuthorizationUrl(params.client, {
    redirect_uri: authCallbackUrl(),
    scope: OIDC_SCOPES,
    code_challenge: await calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state,
  });
  setAuthCookie({
    context: params.context,
    name: OAUTH_STATE_COOKIE,
    value: JSON.stringify({
      state,
      code_verifier: codeVerifier,
      return_to: returnTo,
    }),
    maxAgeSeconds: OAUTH_STATE_MAX_AGE_SECONDS,
  });
  return authorizationUrl.href;
}

export async function exchangeAuthorizationCode(params: {
  context: Context;
  client: Configuration;
  /** Whole IdP response query: openid-client validates `state`, `error` and `iss` from it. */
  callbackParams: URLSearchParams;
  codeVerifier: string;
  state: string;
}): Promise<void> {
  // Origin and path come from config so redirect_uri matches the one registered with the IdP.
  const callbackUrl = new URL(authCallbackUrl());
  callbackUrl.search = params.callbackParams.toString();
  const tokens = await authorizationCodeGrant(params.client, callbackUrl, {
    pkceCodeVerifier: params.codeVerifier,
    expectedState: params.state,
  });
  const idToken = tokens.id_token;
  if (!idToken) {
    throw new Error('Token response missing id_token');
  }
  setAuthCookie({
    context: params.context,
    name: ID_TOKEN_COOKIE,
    value: idToken,
    maxAgeSeconds: ID_TOKEN_COOKIE_MAX_AGE_SECONDS,
  });
}
