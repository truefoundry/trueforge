import * as client from 'openid-client';
import configuration, { type OIDCConfig } from '../config';
import { CALLBACK_PATH, OIDC_SCOPES } from './constants';

let oidcConfiguration: client.Configuration | undefined;

export function oidcConfig(): OIDCConfig | undefined {
  if (configuration.STANDALONE) {
    return undefined;
  }
  return configuration.OIDC;
}

/** Discover the IdP once at process startup when OIDC is configured. */
export async function initOidc(): Promise<void> {
  const oidc = oidcConfig();
  if (!oidc) {
    return;
  }

  const issuer = new URL(oidc.OIDC_ISSUER_URL);
  const discoveryUrl = new URL(
    `${issuer.origin}${issuer.pathname.replace(/\/$/, '')}/.well-known/openid-configuration`,
  );
  discoveryUrl.searchParams.set('client_id', oidc.OIDC_CLIENT_ID);
  oidcConfiguration = await client.discovery(discoveryUrl, oidc.OIDC_CLIENT_ID, oidc.OIDC_CLIENT_SECRET);
}

function requireOidcConfiguration(): client.Configuration {
  if (!oidcConfiguration) {
    throw new Error('OIDC was not initialized; call initOidc() during server startup');
  }
  return oidcConfiguration;
}

export function authCallbackUrl(): string {
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

export async function buildLoginAuthorization(): Promise<{
  authorizationUrl: string;
  state: string;
  codeVerifier: string;
}> {
  const codeVerifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const authorizationUrl = client.buildAuthorizationUrl(requireOidcConfiguration(), {
    redirect_uri: authCallbackUrl(),
    scope: OIDC_SCOPES,
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state,
  });
  return {
    authorizationUrl: authorizationUrl.href,
    state,
    codeVerifier,
  };
}

export async function exchangeAuthorizationCode(options: {
  callbackUrl: URL;
  codeVerifier: string;
  expectedState: string;
}): Promise<{ idToken: string; expiresAtSeconds: number }> {
  const tokens = await client.authorizationCodeGrant(requireOidcConfiguration(), options.callbackUrl, {
    pkceCodeVerifier: options.codeVerifier,
    expectedState: options.expectedState,
  });
  const idToken = tokens.id_token;
  const claims = tokens.claims();
  if (!idToken || !claims?.exp) {
    throw new Error('Token response missing id_token or exp');
  }
  return { idToken, expiresAtSeconds: claims.exp };
}
