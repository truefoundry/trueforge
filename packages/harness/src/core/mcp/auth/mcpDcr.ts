import {
  discoverOAuthServerInfo,
  refreshAuthorization,
  registerClient,
  startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { resourceUrlFromServerUrl } from '@modelcontextprotocol/sdk/shared/auth-utils.js';
import type {
  AuthorizationServerMetadata,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { randomBytes } from 'node:crypto';
import { McpConnectionError } from '../../errors';
import type { IMcpTokenStore } from './IMcpTokenStore';
import {
  mcpAuthorizationServerMetadata,
  mcpAuthorizationServerOrigin,
  mcpClientInformation,
  mcpOAuthCallbackUrl,
} from './mcpOAuthHelpers';
import { McpAuthStatus, type McpOAuthClientRecord, type McpOAuthToken } from './types';

export type ResolveMcpAuthResult =
  | { status: McpAuthStatus.Authenticated; headers: Record<string, string> }
  | { status: McpAuthStatus.AuthenticationRequired; authUrl: URL };

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
}): Promise<McpOAuthClientRecord> {
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
      `Authorization server for MCP server '${mcpServerName}' returned a registration response without client_id`,
      400,
    );
  }

  return {
    clientId: fullInfo.client_id,
    clientSecret: fullInfo.client_secret ?? null,
    authorizationEndpoint,
    tokenEndpoint,
    codeChallengeMethodsSupported: metadata.code_challenge_methods_supported ?? null,
  };
}

export async function createMcpOAuthClient(params: {
  mcpServerUrl: string;
  mcpServerName: string;
  redirectUri: string;
  clientName: string;
}): Promise<McpOAuthClientRecord> {
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
  tokenStore: IMcpTokenStore;
  serverId: string;
  mcpServerUrl: string;
  mcpServerName: string;
  publicBaseUrl: string;
  clientName: string;
}): Promise<McpOAuthClientRecord> {
  const existing = await params.tokenStore.getOAuthClient({ serverId: params.serverId });
  if (existing) {
    return existing;
  }

  const record = await createMcpOAuthClient({
    mcpServerUrl: params.mcpServerUrl,
    mcpServerName: params.mcpServerName,
    redirectUri: mcpOAuthCallbackUrl(params.publicBaseUrl),
    clientName: params.clientName,
  });

  await params.tokenStore.saveOAuthClient({ serverId: params.serverId, record });
  return record;
}

export async function buildMcpAuthorizationUrl(params: {
  tokenStore: IMcpTokenStore;
  serverId: string;
  mcpServerUrl: string;
  mcpServerName: string;
  publicBaseUrl: string;
  clientName: string;
  /** FE post-OAuth landing URL (not the OAuth redirect_uri). */
  redirectUrl?: string;
}): Promise<URL> {
  const client = await ensureMcpClientRegistered({
    tokenStore: params.tokenStore,
    serverId: params.serverId,
    mcpServerUrl: params.mcpServerUrl,
    mcpServerName: params.mcpServerName,
    publicBaseUrl: params.publicBaseUrl,
    clientName: params.clientName,
  });

  // CSRF correlation: opaque state is the pending-row primary key.
  const state = randomBytes(32).toString('base64url');
  const { authorizationUrl, codeVerifier } = await startAuthorization(mcpAuthorizationServerOrigin(client), {
    metadata: mcpAuthorizationServerMetadata(client),
    clientInformation: mcpClientInformation(client),
    redirectUrl: mcpOAuthCallbackUrl(params.publicBaseUrl),
    resource: resourceUrlFromServerUrl(params.mcpServerUrl),
    state,
  });

  await params.tokenStore.savePendingAuthorization({
    state,
    serverId: params.serverId,
    codeVerifier,
    redirectUrl: params.redirectUrl ?? null,
  });

  return authorizationUrl;
}

function isMcpAccessTokenUsable(expiresAtIso: string, nowMs: number): boolean {
  const expiresAtMs = Date.parse(expiresAtIso);
  return !Number.isNaN(expiresAtMs) && expiresAtMs > nowMs;
}

function oauthTokensToMcpOAuthToken(
  tokens: OAuthTokens,
  nowMs: number,
  fallbackRefreshToken: string | null,
): McpOAuthToken {
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
  tokenStore: IMcpTokenStore;
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
  const token = await params.tokenStore.getToken({ serverId: params.serverId });

  if (token && isMcpAccessTokenUsable(token.expiresAt, nowMs)) {
    return {
      status: McpAuthStatus.Authenticated,
      headers: { Authorization: `Bearer ${token.accessToken}` },
    };
  }

  if (token?.refreshToken) {
    const client = await params.tokenStore.getOAuthClient({ serverId: params.serverId });
    if (client) {
      try {
        const refreshed = await refreshAuthorization(mcpAuthorizationServerOrigin(client), {
          metadata: mcpAuthorizationServerMetadata(client),
          clientInformation: mcpClientInformation(client),
          refreshToken: token.refreshToken,
          resource: resourceUrlFromServerUrl(params.mcpServerUrl),
        });
        const saved = oauthTokensToMcpOAuthToken(refreshed, nowMs, token.refreshToken);
        await params.tokenStore.saveToken({ serverId: params.serverId, token: saved });
        return {
          status: McpAuthStatus.Authenticated,
          headers: { Authorization: `Bearer ${saved.accessToken}` },
        };
      } catch {
        // Any refresh failure → full re-authorize (do not inspect the error).
      }
    }
  }

  if (token) {
    await params.tokenStore.deleteToken({ serverId: params.serverId });
  }

  const authUrl = await buildMcpAuthorizationUrl({
    tokenStore: params.tokenStore,
    serverId: params.serverId,
    mcpServerUrl: params.mcpServerUrl,
    mcpServerName: params.mcpServerName,
    publicBaseUrl: params.publicBaseUrl,
    clientName: params.clientName,
    ...(params.redirectUrl !== undefined ? { redirectUrl: params.redirectUrl } : {}),
  });
  return { status: McpAuthStatus.AuthenticationRequired, authUrl };
}
