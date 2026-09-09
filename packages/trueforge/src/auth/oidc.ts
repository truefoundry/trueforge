import type { Context } from 'hono';
import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  type Configuration,
  discovery,
  randomPKCECodeVerifier,
  randomState,
} from 'openid-client';
import { getPublicBaseUrl, type OIDCConfig } from '../config';
import { buildAuthorizationRequestParams, type IdTokenClaims } from './claims';
import { ID_TOKEN_COOKIE, OAUTH_STATE_COOKIE, setAuthCookie } from './cookies';
import { assertEmailAllowed } from './emailAllowlist';
import { safeReturnTo } from './safeReturnTo';

const CALLBACK_PATH = '/api/v1/auth/callback';
const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;
const ID_TOKEN_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

/** JWKS + claim config used by cookie JWT verification when auth is enabled. */
export interface OidcVerify {
  jwks: JWTVerifyGetKey;
  issuer: string;
  audience: string;
  oidcConfig: OIDCConfig;
}

/** Single instance of the OIDC verification. */
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

/** Disable OIDC cookie auth (no IdP / standalone). Protected routes use the default user context. */
export function disableOidcAuth(): void {
  oidcVerify = null;
}

/** Active verification config, or `null` when auth is disabled. */
export function getOidcVerify(): OidcVerify | null {
  return oidcVerify;
}

/** Discover the IdP once at process startup when auth is enabled; wires cookie auth verification. */
export async function initOidc(oidc: OIDCConfig | undefined): Promise<Configuration | undefined> {
  if (!oidc) {
    disableOidcAuth();
    return undefined;
  }

  const client = await discovery(new URL(oidc.OIDC_ISSUER_URL), oidc.OIDC_CLIENT_ID, oidc.OIDC_CLIENT_SECRET);
  enableOidcAuth({ client, oidcConfig: oidc });
  return client;
}

function authCallbackUrl(): string {
  const publicBaseUrl = getPublicBaseUrl();
  return `${publicBaseUrl}${CALLBACK_PATH}`;
}

export async function buildLoginAuthorization(params: {
  context: Context;
  client: Configuration;
  returnTo: string | undefined;
}): Promise<string> {
  const oidcConfig = getOidcVerify()?.oidcConfig;
  if (!oidcConfig) {
    throw new Error(
      'OIDC claim configuration is unavailable; call initOidc before building a login authorization URL.',
    );
  }

  const { scopes, claims } = buildAuthorizationRequestParams(oidcConfig);
  const returnTo = safeReturnTo(params.returnTo);
  const codeVerifier = randomPKCECodeVerifier();
  const state = randomState();
  const authorizationUrl = buildAuthorizationUrl(params.client, {
    redirect_uri: authCallbackUrl(),
    scope: scopes.join(' '),
    claims: JSON.stringify(claims),
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
  const oidcConfig = getOidcVerify()?.oidcConfig;
  if (!oidcConfig) {
    throw new Error('OIDC claim configuration is unavailable; call initOidc before exchanging an authorization code.');
  }

  const tokens = await authorizationCodeGrant(params.client, callbackUrl, {
    pkceCodeVerifier: params.codeVerifier,
    expectedState: params.state,
  });
  const idToken = tokens.id_token;
  if (!idToken) {
    throw new Error('Token response missing id_token');
  }

  // Reject before stamping the cookie so disallowed users never get a session.
  const tokenClaims = tokens.claims();
  const claims: IdTokenClaims = tokenClaims ? { ...tokenClaims } : {};
  assertEmailAllowed(claims, oidcConfig);

  setAuthCookie({
    context: params.context,
    name: ID_TOKEN_COOKIE,
    value: idToken,
    maxAgeSeconds: ID_TOKEN_COOKIE_MAX_AGE_SECONDS,
  });
}
