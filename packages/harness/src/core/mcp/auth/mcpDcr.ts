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
  const { authorizationUrl, codeVerifier } = await startAuthorization(mcpAuthorizationServerOrigin(client.server), {
    metadata: mcpAuthorizationServerMetadata(client.server),
    clientInformation: mcpClientInformation(client.client),
    redirectUrl: mcpOAuthCallbackUrl(params.publicBaseUrl),
    resource: resourceUrlFromServerUrl(params.mcpServerUrl),
    state,
  });

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
