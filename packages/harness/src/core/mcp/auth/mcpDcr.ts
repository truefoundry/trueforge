import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  refreshAuthorization,
  registerClient,
  startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { InvalidClientError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { resourceUrlFromServerUrl } from '@modelcontextprotocol/sdk/shared/auth-utils.js';
import type {
  AuthorizationServerMetadata,
  OAuthClientMetadata,
  OAuthTokens,
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
  mcpServerStore: IOAuthClientStore;
  serverId: string;
  mcpServerUrl: string;
  mcpServerName: string;
  clientName: string;
}): Promise<OAuthClientRecord> {
  const existing = await params.mcpServerStore.getClient({ id: params.serverId });
  if (existing) {
    return existing;
  }

  const client = await createMcpOAuthClient({
    mcpServerUrl: params.mcpServerUrl,
    mcpServerName: params.mcpServerName,
    redirectUri: mcpOAuthCallbackUrl(),
    clientName: params.clientName,
  });

  await params.mcpServerStore.saveClient({ id: params.serverId, record: client });
  return client;
}

export async function buildMcpAuthorizationUrl(params: {
  tokenStore: IOAuthTokenStore;
  mcpServerStore: IOAuthClientStore;
  serverId: string;
  mcpServerUrl: string;
  mcpServerName: string;
  clientName: string;
  /** FE post-OAuth landing URL (not the OAuth redirect_uri). */
  redirectUrl?: string;
}): Promise<URL> {
  const client = await ensureMcpClientRegistered({
    mcpServerStore: params.mcpServerStore,
    serverId: params.serverId,
    mcpServerUrl: params.mcpServerUrl,
    mcpServerName: params.mcpServerName,
    clientName: params.clientName,
  });

  if (client.server.codeChallengeMethodsSupported?.includes('S256') !== true) {
    throw new McpConnectionError(
      `Authorization server for MCP server '${params.mcpServerName}' does not advertise PKCE S256; S256 is required`,
      400,
    );
  }

  const state = randomBytes(32).toString('base64url');
  const redirectUri = mcpOAuthCallbackUrl();
  const resource = resourceUrlFromServerUrl(params.mcpServerUrl);

  const started = await startAuthorization(mcpAuthorizationServerOrigin(client.server), {
    metadata: mcpAuthorizationServerMetadata(client.server),
    clientInformation: mcpClientInformation(client.client),
    redirectUrl: redirectUri,
    resource,
    state,
  });

  await params.tokenStore.savePendingAuthorization({
    state,
    id: params.serverId,
    mcpServerUrl: params.mcpServerUrl,
    codeVerifier: started.codeVerifier,
    redirectUrl: params.redirectUrl ?? null,
  });

  return started.authorizationUrl;
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
  mcpServerStore: IOAuthClientStore;
  serverId: string;
  mcpServerUrl: string;
  mcpServerName: string;
  clientName: string;
  /** FE post-OAuth landing URL (not the OAuth redirect_uri). */
  redirectUrl?: string;
}): Promise<ResolveMcpAuthResult> {
  const nowMs = Date.now();
  const token = await params.tokenStore.getToken({ id: params.serverId });

  if (token && isMcpAccessTokenUsable(token.expiresAt, nowMs)) {
    return { headers: { Authorization: `Bearer ${token.accessToken}` } };
  }

  if (token?.refreshToken) {
    const client = await params.mcpServerStore.getClient({ id: params.serverId });
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
    mcpServerStore: params.mcpServerStore,
    serverId: params.serverId,
    mcpServerUrl: params.mcpServerUrl,
    mcpServerName: params.mcpServerName,
    clientName: params.clientName,
    ...(params.redirectUrl !== undefined ? { redirectUrl: params.redirectUrl } : {}),
  });
  return { authUrl };
}

/**
 * OAuth callback: exchange `code` for tokens. Route must already reject IdP `error` params.
 * Claims pending state atomically (`consumePendingAuthorization`) so duplicate callbacks lose
 * the race; `mcpServerUrl` for the RFC 8707 `resource` comes from that pending row.
 * On `invalid_client`, clears stored client + token so the next authorize re-registers.
 */
export async function completeMcpAuthorization(params: {
  tokenStore: IOAuthTokenStore;
  mcpServerStore: IOAuthClientStore;
  state: string;
  code: string;
}): Promise<CompleteMcpAuthorizationResult> {
  const nowMs = Date.now();

  // Consume first so a concurrent/duplicate callback cannot redeem the same state.
  const pending = await params.tokenStore.consumePendingAuthorization({ state: params.state });
  if (!pending) {
    throw new McpConnectionError('Unknown or expired OAuth state', 400);
  }

  const client = await params.mcpServerStore.getClient({ id: pending.id });
  if (!client) {
    throw new McpConnectionError(
      `No OAuth client registered for MCP server id '${pending.id}'; re-run authorize first`,
      400,
    );
  }

  const { codeVerifier } = pending;
  if (codeVerifier === null) {
    throw new McpConnectionError('Pending authorization is missing PKCE code_verifier; re-run authorize', 400);
  }

  let tokens: OAuthTokens;
  try {
    tokens = await exchangeAuthorization(mcpAuthorizationServerOrigin(client.server), {
      metadata: mcpAuthorizationServerMetadata(client.server),
      clientInformation: mcpClientInformation(client.client),
      authorizationCode: params.code,
      codeVerifier,
      redirectUri: mcpOAuthCallbackUrl(),
      resource: resourceUrlFromServerUrl(pending.mcpServerUrl),
    });
  } catch (error: unknown) {
    if (error instanceof InvalidClientError) {
      await params.tokenStore.deleteToken({ id: pending.id });
      await params.mcpServerStore.deleteClient({ id: pending.id });
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

  return { serverId: pending.id, redirectUrl: pending.redirectUrl };
}
