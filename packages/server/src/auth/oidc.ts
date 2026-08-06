import type { Context } from 'hono';
import * as client from 'openid-client';
import type { Logger } from 'winston';
import configuration, { type OIDCConfig, oidcConfig } from '../config';
import { ID_TOKEN_COOKIE, OAUTH_STATE_COOKIE, setAuthCookie } from './cookies';

const CALLBACK_PATH = '/api/v1/auth/callback';
const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;
const OIDC_SCOPES = 'openid email profile';

let initializedOidc: { oidc: OIDCConfig; client: client.Configuration } | undefined;

/** Discover the IdP once at process startup when OIDC is configured. */
export async function initOidc(options: { logger: Logger }): Promise<void> {
  const oidc = oidcConfig();
  if (!oidc) {
    options.logger.warn('OIDC is not configured; browser login is disabled');
    return;
  }

  options.logger.info('OIDC is configured', { issuer: oidc.OIDC_ISSUER_URL });
  const issuer = new URL(oidc.OIDC_ISSUER_URL);
  const discoveryUrl = new URL(
    `${issuer.origin}${issuer.pathname.replace(/\/$/, '')}/.well-known/openid-configuration`,
  );
  discoveryUrl.searchParams.set('client_id', oidc.OIDC_CLIENT_ID);
  const discoveredClient = await client.discovery(discoveryUrl, oidc.OIDC_CLIENT_ID, oidc.OIDC_CLIENT_SECRET);
  initializedOidc = { oidc, client: discoveredClient };
}

function requireOidcConfiguration(oidc: OIDCConfig): client.Configuration {
  if (initializedOidc?.oidc !== oidc) {
    throw new Error('OIDC was not initialized; call initOidc() during server startup');
  }
  return initializedOidc.client;
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

export async function buildLoginAuthorization(options: {
  context: Context;
  oidc: OIDCConfig;
  returnTo: string | undefined;
}): Promise<string> {
  const returnTo = safeReturnTo(options.returnTo);
  const codeVerifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const authorizationUrl = client.buildAuthorizationUrl(requireOidcConfiguration(options.oidc), {
    redirect_uri: authCallbackUrl(),
    scope: OIDC_SCOPES,
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state,
  });
  setAuthCookie({
    context: options.context,
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

export async function exchangeAuthorizationCode(options: {
  context: Context;
  oidc: OIDCConfig;
  code: string;
  codeVerifier: string;
  expectedState: string;
}): Promise<void> {
  // redirect_uri is fixed; openid-client still needs the IdP response query (code + state).
  const callbackUrl = new URL(authCallbackUrl());
  callbackUrl.searchParams.set('code', options.code);
  callbackUrl.searchParams.set('state', options.expectedState);
  const tokens = await client.authorizationCodeGrant(requireOidcConfiguration(options.oidc), callbackUrl, {
    pkceCodeVerifier: options.codeVerifier,
    expectedState: options.expectedState,
  });
  const idToken = tokens.id_token;
  const expiresAtSeconds = tokens.claims()?.exp;
  if (!idToken || !expiresAtSeconds) {
    throw new Error('Token response missing id_token or exp');
  }
  setAuthCookie({
    context: options.context,
    name: ID_TOKEN_COOKIE,
    value: idToken,
    maxAgeSeconds: Math.max(0, expiresAtSeconds - Math.floor(Date.now() / 1000)),
  });
}
