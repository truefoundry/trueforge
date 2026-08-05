import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  refreshAuthorization,
  registerClient,
  startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { InvalidClientError, InvalidClientMetadataError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { resourceUrlFromServerUrl } from '@modelcontextprotocol/sdk/shared/auth-utils.js';
import type {
  AuthorizationServerMetadata,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { McpConnectionError, McpDcrConfigurationError } from '@truefoundry/utils-core/core';
import { randomBytes } from 'node:crypto';
import {
  isOAuthAccessTokenUsable,
  mcpAuthorizationServerMetadata,
  mcpAuthorizationServerOrigin,
  mcpClientInformation,
  mcpOAuthCallbackUrl,
  oauthTokensToOAuthToken,
} from './mcpOAuthHelpers';
import type {
  IOAuthClientStore,
  IOAuthTokenStore,
  McpAuthRequiredResult,
  OAuthClientRecord,
  OAuthPendingAuthorization,
  ResolveMcpAuthResult,
} from './types';

export function isMcpAuthRequired(result: ResolveMcpAuthResult): result is McpAuthRequiredResult {
  return 'authUrl' in result;
}

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
    if (!(firstError instanceof InvalidClientMetadataError)) {
      throw new McpConnectionError(
        `Failed to dynamically register OAuth client for MCP server '${mcpServerName}'`,
        400,
        { cause: firstError instanceof Error ? firstError : undefined },
      );
    }
    try {
      fullInfo = await registerClient(authorizationServerUrl, { metadata, clientMetadata });
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
    throw new McpDcrConfigurationError(
      `MCP server '${mcpServerName}' has no DCR support (missing registration_endpoint); auth.type: dcr is misconfigured for this server`,
    );
  }
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new McpDcrConfigurationError(
      `Authorization server for MCP server '${mcpServerName}' is missing authorization_endpoint or token_endpoint`,
    );
  }
  const pkceMethods = metadata.code_challenge_methods_supported;
  if (pkceMethods && !pkceMethods.includes('S256')) {
    throw new McpDcrConfigurationError(
      `Authorization server for MCP server '${mcpServerName}' advertises PKCE methods without S256`,
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
  redirectUrl?: string;
}): Promise<URL> {
  const client = await ensureMcpClientRegistered({
    mcpServerStore: params.mcpServerStore,
    serverId: params.serverId,
    mcpServerUrl: params.mcpServerUrl,
    mcpServerName: params.mcpServerName,
    clientName: params.clientName,
  });
  const state = randomBytes(32).toString('base64url');
  const redirectUri = mcpOAuthCallbackUrl();
  let started: Awaited<ReturnType<typeof startAuthorization>>;
  try {
    started = await startAuthorization(mcpAuthorizationServerOrigin(client.server), {
      metadata: mcpAuthorizationServerMetadata(client.server),
      clientInformation: mcpClientInformation(client.client),
      redirectUrl: redirectUri,
      resource: resourceUrlFromServerUrl(params.mcpServerUrl),
      state,
    });
  } catch (error: unknown) {
    throw new McpConnectionError(`Failed to start OAuth authorization for MCP server '${params.mcpServerName}'`, 400, {
      cause: error instanceof Error ? error : undefined,
    });
  }
  await params.tokenStore.savePendingAuthorization({
    state,
    id: params.serverId,
    mcpServerUrl: params.mcpServerUrl,
    codeVerifier: started.codeVerifier,
    redirectUrl: params.redirectUrl ?? null,
  });
  return started.authorizationUrl;
}

export async function resolveMcpAuth(params: {
  tokenStore: IOAuthTokenStore;
  mcpServerStore: IOAuthClientStore;
  serverId: string;
  mcpServerUrl: string;
  mcpServerName: string;
  clientName: string;
  redirectUrl?: string;
}): Promise<ResolveMcpAuthResult> {
  const nowMs = Date.now();
  const token = await params.tokenStore.getToken({ id: params.serverId });
  if (token && isOAuthAccessTokenUsable(token.expiresAt, nowMs)) {
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
        // Refresh failure falls through to a fresh authorization.
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
 * Exchanges `code` for tokens against an already-claimed `pending` row: the caller claims it with
 * `consumePendingAuthorization` so duplicate callbacks lose the race, and keeps it for its FE
 * landing URL. Route must already reject IdP `error` params. On `invalid_client`, clears the stored
 * client and token so the next authorize re-registers.
 */
export async function completeMcpAuthorization(params: {
  tokenStore: IOAuthTokenStore;
  mcpServerStore: IOAuthClientStore;
  pending: OAuthPendingAuthorization;
  code: string;
}): Promise<void> {
  const nowMs = Date.now();
  const { pending } = params;

  const client = await params.mcpServerStore.getClient({ id: pending.id });
  if (!client) {
    throw new McpConnectionError(
      `No OAuth client registered for MCP server id '${pending.id}'; re-run authorize first`,
      400,
    );
  }
  if (pending.codeVerifier === null) {
    throw new McpConnectionError('Pending authorization is missing PKCE code_verifier; re-run authorize', 400);
  }
  let tokens: OAuthTokens;
  try {
    tokens = await exchangeAuthorization(mcpAuthorizationServerOrigin(client.server), {
      metadata: mcpAuthorizationServerMetadata(client.server),
      clientInformation: mcpClientInformation(client.client),
      authorizationCode: params.code,
      codeVerifier: pending.codeVerifier,
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
}
