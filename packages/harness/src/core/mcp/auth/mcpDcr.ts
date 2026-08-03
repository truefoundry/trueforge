import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  parseErrorResponse,
  refreshAuthorization,
  registerClient,
  startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { InvalidClientError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { resourceUrlFromServerUrl } from '@modelcontextprotocol/sdk/shared/auth-utils.js';
import {
  OAuthTokensSchema,
  type AuthorizationServerMetadata,
  type OAuthClientMetadata,
  type OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { randomBytes } from 'node:crypto';
import type { IOAuthClientStore, OAuthClientRecord } from '../../auth/IOAuthClientStore';
import type { IOAuthTokenStore, OAuthToken } from '../../auth/IOAuthTokenStore';
import { McpConnectionError } from '../../errors';
import {
  mcpAuthorizationServerMetadata,
  mcpAuthorizationServerOrigin,
  mcpClientInformation,
  mcpOAuthCallbackUrl,
} from './mcpOAuthHelpers';

export interface McpAuthResolvedResult {
  headers: Record<string, string>;
}

export interface McpAuthRequiredResult {
  authUrl: URL;
}

export type ResolveMcpAuthResult = McpAuthResolvedResult | McpAuthRequiredResult;

export function isMcpAuthRequired(result: ResolveMcpAuthResult): result is McpAuthRequiredResult {
  return 'authUrl' in result;
}

/** Result of a successful `completeMcpAuthorization` (token saved, pending cleared). */
export interface CompleteMcpAuthorizationResult {
  serverId: string;
  /** FE post-OAuth landing URL from the original authorize call. */
  redirectUrl: string | null;
}

/**
 * When the token response omits `expires_in` (allowed by RFC 6749), use a 1h TTL so
 * the saved token is not treated as already expired on the next `resolveMcpAuth`.
 */
export const DEFAULT_MCP_ACCESS_TOKEN_TTL_SECONDS = 3600;

/**
 * Prefer `client_secret_post` (confidential). Authorization servers that only issue public
 * clients or only accept other methods can reject that; retry once without the field (same as
 * servicefoundry outbound DCR), then surface. Not a loop.
 */
async function registerMcpClientWithAuthMethodFallback(params: {
  authorizationServerUrl: string;
  metadata: AuthorizationServerMetadata;
  clientMetadata: OAuthClientMetadata;
  mcpServerName: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
}): Promise<OAuthClientRecord> {
  const { authorizationServerUrl, metadata, clientMetadata, mcpServerName, authorizationEndpoint, tokenEndpoint } =
    params;

  let fullInfo;
  try {
    fullInfo = await registerClient(authorizationServerUrl, {
      metadata,
      clientMetadata: { ...clientMetadata, token_endpoint_auth_method: 'client_secret_post' },
    });
  } catch (firstError: unknown) {
    try {
      // Omit method so the authorization server applies its default (parity with servicefoundry).
      fullInfo = await registerClient(authorizationServerUrl, {
        metadata,
        clientMetadata,
      });
    } catch (secondError: unknown) {
      throw new McpConnectionError(
        `Failed to dynamically register OAuth client for MCP server '${mcpServerName}'`,
        400,
        { cause: secondError instanceof Error ? secondError : firstError },
      );
    }
  }

  if (!fullInfo.client_id) {
    throw new McpConnectionError(
      `Authorization server for MCP server '${mcpServerName}' returned a client response without client_id`,
      400,
    );
  }

  return {
    server: {
      authorizationEndpoint,
      tokenEndpoint,
      codeChallengeMethodsSupported: metadata.code_challenge_methods_supported ?? null,
    },
    client: {
      clientId: fullInfo.client_id,
      clientSecret: fullInfo.client_secret ?? null,
    },
  };
}

export async function createMcpOAuthClient(params: {
  mcpServerUrl: string;
  mcpServerName: string;
  redirectUri: string;
  clientName: string;
}): Promise<OAuthClientRecord> {
  const { mcpServerUrl, mcpServerName, redirectUri, clientName } = params;

  const { authorizationServerUrl, authorizationServerMetadata: metadata } = await discoverOAuthServerInfo(mcpServerUrl);

  if (!metadata?.registration_endpoint) {
    throw new McpConnectionError(
      `MCP server '${mcpServerName}' has no DCR support (missing registration_endpoint); auth.type: dcr is misconfigured for this server`,
      400,
    );
  }

  if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new McpConnectionError(
      `Authorization server for MCP server '${mcpServerName}' is missing authorization_endpoint or token_endpoint`,
      400,
    );
  }

  return registerMcpClientWithAuthMethodFallback({
    authorizationServerUrl,
    metadata,
    clientMetadata: {
      client_name: clientName,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    mcpServerName,
    authorizationEndpoint: metadata.authorization_endpoint,
    tokenEndpoint: metadata.token_endpoint,
  });
}

export async function ensureMcpClientRegistered(params: {
  clientStore: IOAuthClientStore;
  serverId: string;
  mcpServerUrl: string;
  mcpServerName: string;
  publicBaseUrl: string;
  clientName: string;
}): Promise<OAuthClientRecord> {
  const existing = await params.clientStore.getClient({ id: params.serverId });
  if (existing) {
    return existing;
  }

  const client = await createMcpOAuthClient({
    mcpServerUrl: params.mcpServerUrl,
    mcpServerName: params.mcpServerName,
    redirectUri: mcpOAuthCallbackUrl(params.publicBaseUrl),
    clientName: params.clientName,
  });

  await params.clientStore.saveClient({ id: params.serverId, record: client });
  return client;
}

/**
 * SF parity: PKCE only when the AS explicitly lists S256.
 * Without it, `exchangeAuthorization` cannot be used (it always requires a verifier).
 */
async function exchangeAuthorizationCode(params: {
  client: OAuthClientRecord;
  authorizationCode: string;
  codeVerifier: string | null;
  redirectUri: string;
  resource: URL;
}): Promise<OAuthTokens> {
  const { client, authorizationCode, codeVerifier, redirectUri, resource } = params;

  if (codeVerifier) {
    return exchangeAuthorization(mcpAuthorizationServerOrigin(client.server), {
      metadata: mcpAuthorizationServerMetadata(client.server),
      clientInformation: mcpClientInformation(client.client),
      authorizationCode,
      codeVerifier,
      redirectUri,
      resource,
    });
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: authorizationCode,
    redirect_uri: redirectUri,
    client_id: client.client.clientId,
    resource: resource.href,
  });
  if (client.client.clientSecret) {
    body.set('client_secret', client.client.clientSecret);
  }

  const response = await fetch(client.server.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  if (!response.ok) {
    throw await parseErrorResponse(response);
  }
  return OAuthTokensSchema.parse(await response.json());
}

export async function buildMcpAuthorizationUrl(params: {
  tokenStore: IOAuthTokenStore;
  clientStore: IOAuthClientStore;
  serverId: string;
  mcpServerUrl: string;
  mcpServerName: string;
  publicBaseUrl: string;
  clientName: string;
  /** FE post-OAuth landing URL (not the OAuth redirect_uri). */
  redirectUrl?: string;
}): Promise<URL> {
  const client = await ensureMcpClientRegistered({
    clientStore: params.clientStore,
    serverId: params.serverId,
    mcpServerUrl: params.mcpServerUrl,
    mcpServerName: params.mcpServerName,
    publicBaseUrl: params.publicBaseUrl,
    clientName: params.clientName,
  });

  const state = randomBytes(32).toString('base64url');
  const redirectUri = mcpOAuthCallbackUrl(params.publicBaseUrl);
  const resource = resourceUrlFromServerUrl(params.mcpServerUrl);
  const usePkce = client.server.codeChallengeMethodsSupported?.includes('S256') === true;

  let authorizationUrl: URL;
  let codeVerifier: string | null = null;

  if (usePkce) {
    const started = await startAuthorization(mcpAuthorizationServerOrigin(client.server), {
      metadata: mcpAuthorizationServerMetadata(client.server),
      clientInformation: mcpClientInformation(client.client),
      redirectUrl: redirectUri,
      resource,
      state,
    });
    authorizationUrl = started.authorizationUrl;
    codeVerifier = started.codeVerifier;
  } else {
    // No S256 advertised — skip challenge/verifier (SF outbound).
    authorizationUrl = new URL(client.server.authorizationEndpoint);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('client_id', client.client.clientId);
    authorizationUrl.searchParams.set('redirect_uri', redirectUri);
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('resource', resource.href);
  }

  await params.tokenStore.savePendingAuthorization({
    state,
    id: params.serverId,
    codeVerifier,
    redirectUrl: params.redirectUrl ?? null,
  });

  return authorizationUrl;
}

function isMcpAccessTokenUsable(expiresAtIso: string, nowMs: number): boolean {
  const expiresAtMs = Date.parse(expiresAtIso);
  return !Number.isNaN(expiresAtMs) && expiresAtMs > nowMs;
}

function oauthTokensToOAuthToken(tokens: OAuthTokens, nowMs: number, fallbackRefreshToken: string | null): OAuthToken {
  const expiresInSeconds = tokens.expires_in ?? DEFAULT_MCP_ACCESS_TOKEN_TTL_SECONDS;
  const expiresAtMs = nowMs + expiresInSeconds * 1000;
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? fallbackRefreshToken,
    expiresAt: new Date(expiresAtMs).toISOString(),
    scope: tokens.scope ?? null,
  };
}

export async function resolveMcpAuth(params: {
  tokenStore: IOAuthTokenStore;
  clientStore: IOAuthClientStore;
  serverId: string;
  mcpServerUrl: string;
  mcpServerName: string;
  publicBaseUrl: string;
  clientName: string;
  /** FE post-OAuth landing URL (not the OAuth redirect_uri). */
  redirectUrl?: string;
  nowMs?: number;
}): Promise<ResolveMcpAuthResult> {
  const nowMs = params.nowMs ?? Date.now();
  const token = await params.tokenStore.getToken({ id: params.serverId });

  if (token && isMcpAccessTokenUsable(token.expiresAt, nowMs)) {
    return { headers: { Authorization: `Bearer ${token.accessToken}` } };
  }

  if (token?.refreshToken) {
    const client = await params.clientStore.getClient({ id: params.serverId });
    if (client) {
      try {
        const refreshed = await refreshAuthorization(mcpAuthorizationServerOrigin(client.server), {
          metadata: mcpAuthorizationServerMetadata(client.server),
          clientInformation: mcpClientInformation(client.client),
          refreshToken: token.refreshToken,
          resource: resourceUrlFromServerUrl(params.mcpServerUrl),
        });
        const saved = oauthTokensToOAuthToken(refreshed, nowMs, token.refreshToken);
        await params.tokenStore.saveToken({ id: params.serverId, token: saved });
        return { headers: { Authorization: `Bearer ${saved.accessToken}` } };
      } catch {
        // Any refresh failure → full re-authorize (do not inspect the error).
      }
    }
  }

  if (token) {
    await params.tokenStore.deleteToken({ id: params.serverId });
  }

  const authUrl = await buildMcpAuthorizationUrl({
    tokenStore: params.tokenStore,
    clientStore: params.clientStore,
    serverId: params.serverId,
    mcpServerUrl: params.mcpServerUrl,
    mcpServerName: params.mcpServerName,
    publicBaseUrl: params.publicBaseUrl,
    clientName: params.clientName,
    ...(params.redirectUrl !== undefined ? { redirectUrl: params.redirectUrl } : {}),
  });
  return { authUrl };
}

/**
 * OAuth callback: exchange `code` for tokens. Route must already reject IdP `error` params.
 * On `invalid_client`, clears stored client + token so the next authorize re-registers.
 */
export async function completeMcpAuthorization(params: {
  tokenStore: IOAuthTokenStore;
  clientStore: IOAuthClientStore;
  state: string;
  code: string;
  mcpServerUrl: string;
  publicBaseUrl: string;
  nowMs?: number;
}): Promise<CompleteMcpAuthorizationResult> {
  const nowMs = params.nowMs ?? Date.now();

  const pending = await params.tokenStore.getPendingAuthorization({ state: params.state });
  if (!pending) {
    throw new McpConnectionError('Unknown or expired OAuth state', 400);
  }

  const client = await params.clientStore.getClient({ id: pending.id });
  if (!client) {
    throw new McpConnectionError(
      `No OAuth client registered for MCP server id '${pending.id}'; re-run authorize first`,
      400,
    );
  }

  let tokens: OAuthTokens;
  try {
    tokens = await exchangeAuthorizationCode({
      client,
      authorizationCode: params.code,
      codeVerifier: pending.codeVerifier,
      redirectUri: mcpOAuthCallbackUrl(params.publicBaseUrl),
      resource: resourceUrlFromServerUrl(params.mcpServerUrl),
    });
  } catch (error: unknown) {
    if (error instanceof InvalidClientError) {
      await params.tokenStore.deleteToken({ id: pending.id });
      await params.clientStore.deleteClient({ id: pending.id });
      throw new McpConnectionError('OAuth client registration is invalid; please retry connecting', 400, {
        cause: error,
      });
    }
    throw new McpConnectionError('OAuth token exchange failed', 400, {
      cause: error instanceof Error ? error : undefined,
    });
  }

  await params.tokenStore.saveToken({
    id: pending.id,
    token: oauthTokensToOAuthToken(tokens, nowMs, null),
  });
  await params.tokenStore.deletePendingAuthorization({ state: params.state });

  return { serverId: pending.id, redirectUrl: pending.redirectUrl };
}
