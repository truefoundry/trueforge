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
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { McpConnectionError, McpDcrConfigurationError } from '@truefoundry/trueforge-core/core';
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

/** Per-request timeout for MCP OAuth discovery, DCR, and token HTTP calls. */
export const MCP_OAUTH_HTTP_TIMEOUT_MS = 15_000;

/**
 * Abort hung authorization-server HTTP. Merges with any caller `signal` so both can cancel the request.
 * Used by discoverOAuthServerInfo / registerClient / refreshAuthorization / exchangeAuthorization
 * (startAuthorization is local PKCE + URL construction and never calls this).
 */
const mcpOAuthFetch: FetchLike = (url, init) => {
  const timeoutSignal = AbortSignal.timeout(MCP_OAUTH_HTTP_TIMEOUT_MS);
  const signal = init?.signal != null ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  return fetch(url, { ...init, signal });
};

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

/** Same status as non-timeout faults; appends a timeout note so the API body is actionable. */
function mcpOAuthConnectionError(message: string, error: unknown, statusCode: number): McpConnectionError {
  let body = message;
  if (isTimeoutError(error)) {
    body = `${message}: timed out after ${String(MCP_OAUTH_HTTP_TIMEOUT_MS / 1000)}s waiting for the authorization server`;
  }
  return new McpConnectionError(body, statusCode, { cause: error });
}

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
      fetchFn: mcpOAuthFetch,
    });
  } catch (firstError: unknown) {
    if (!(firstError instanceof InvalidClientMetadataError)) {
      throw mcpOAuthConnectionError(
        `Failed to dynamically register OAuth client for MCP server '${mcpServerName}'`,
        firstError,
        424,
      );
    }
    try {
      fullInfo = await registerClient(authorizationServerUrl, {
        metadata,
        clientMetadata,
        fetchFn: mcpOAuthFetch,
      });
    } catch (secondError: unknown) {
      throw mcpOAuthConnectionError(
        `Failed to dynamically register OAuth client for MCP server '${mcpServerName}'`,
        secondError,
        424,
      );
    }
  }
  if (!fullInfo.client_id) {
    throw new McpConnectionError(
      `Authorization server for MCP server '${mcpServerName}' returned a client response without client_id`,
      424,
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

/**
 * Discovers the MCP server's authorization server, validates DCR + S256 PKCE support, and
 * registers a new OAuth client (RFC 7591). Returns AS endpoints + client credentials for the
 * caller to persist; does not write to the store.
 */
export async function createMcpOAuthClient(params: {
  mcpServerUrl: string;
  mcpServerName: string;
  redirectUri: string;
  clientName: string;
}): Promise<OAuthClientRecord> {
  const { mcpServerUrl, mcpServerName, redirectUri, clientName } = params;
  let discovered: Awaited<ReturnType<typeof discoverOAuthServerInfo>>;
  try {
    discovered = await discoverOAuthServerInfo(mcpServerUrl, { fetchFn: mcpOAuthFetch });
  } catch (error: unknown) {
    throw mcpOAuthConnectionError(
      `Failed to discover OAuth authorization server for MCP server '${mcpServerName}'`,
      error,
      424,
    );
  }
  const { authorizationServerUrl, authorizationServerMetadata: metadata } = discovered;
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

/**
 * Returns the stored OAuth client for `serverId`, or discovers + DCR-registers and persists one.
 * Used from `resolveMcpAuth` only — callers that already hold the client should pass it through.
 */
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

/** Builds the AS authorize URL and saves the pending PKCE row. Caller must already have `client`. */
export async function buildMcpAuthorizationUrl(params: {
  tokenStore: IOAuthTokenStore;
  client: OAuthClientRecord;
  serverId: string;
  userRef: string;
  mcpServerUrl: string;
  mcpServerName: string;
  returnTo?: string;
}): Promise<URL> {
  const state = randomBytes(32).toString('base64url');
  const redirectUri = mcpOAuthCallbackUrl();
  let started: Awaited<ReturnType<typeof startAuthorization>>;
  try {
    started = await startAuthorization(mcpAuthorizationServerOrigin(params.client.server), {
      metadata: mcpAuthorizationServerMetadata(params.client.server),
      clientInformation: mcpClientInformation(params.client.client),
      redirectUrl: redirectUri,
      resource: resourceUrlFromServerUrl(params.mcpServerUrl),
      state,
    });
  } catch (error: unknown) {
    throw new McpConnectionError(`Failed to start OAuth authorization for MCP server '${params.mcpServerName}'`, 424, {
      cause: error,
    });
  }
  await params.tokenStore.savePendingAuthorization({
    state,
    id: params.serverId,
    userRef: params.userRef,
    mcpServerUrl: params.mcpServerUrl,
    codeVerifier: started.codeVerifier,
    returnTo: params.returnTo ?? null,
  });
  return started.authorizationUrl;
}

export async function resolveMcpAuth(params: {
  tokenStore: IOAuthTokenStore;
  mcpServerStore: IOAuthClientStore;
  serverId: string;
  userRef: string;
  mcpServerUrl: string;
  mcpServerName: string;
  clientName: string;
  returnTo?: string;
}): Promise<ResolveMcpAuthResult> {
  const nowMs = Date.now();
  const tokenKey = { id: params.serverId, userRef: params.userRef };
  const token = await params.tokenStore.getToken(tokenKey);
  if (token && isOAuthAccessTokenUsable(token.expiresAt, nowMs)) {
    return { headers: { Authorization: `Bearer ${token.accessToken}` } };
  }
  const client = await ensureMcpClientRegistered({
    mcpServerStore: params.mcpServerStore,
    serverId: params.serverId,
    mcpServerUrl: params.mcpServerUrl,
    mcpServerName: params.mcpServerName,
    clientName: params.clientName,
  });
  if (token?.refreshToken) {
    try {
      const refreshed = await refreshAuthorization(mcpAuthorizationServerOrigin(client.server), {
        metadata: mcpAuthorizationServerMetadata(client.server),
        clientInformation: mcpClientInformation(client.client),
        refreshToken: token.refreshToken,
        resource: resourceUrlFromServerUrl(params.mcpServerUrl),
        fetchFn: mcpOAuthFetch,
      });
      const saved = oauthTokensToOAuthToken(refreshed, nowMs, token.refreshToken);
      await params.tokenStore.saveToken({ ...tokenKey, token: saved });
      return { headers: { Authorization: `Bearer ${saved.accessToken}` } };
    } catch {
      // Refresh failure falls through to a fresh authorization.
    }
  }
  if (token) {
    await params.tokenStore.deleteToken(tokenKey);
  }
  const authUrl = await buildMcpAuthorizationUrl({
    tokenStore: params.tokenStore,
    client,
    serverId: params.serverId,
    userRef: params.userRef,
    mcpServerUrl: params.mcpServerUrl,
    mcpServerName: params.mcpServerName,
    ...(params.returnTo !== undefined ? { returnTo: params.returnTo } : {}),
  });
  return { authUrl };
}

/**
 * Exchanges `code` for tokens against an already-claimed `pending` row: the caller claims it with
 * `consumePendingAuthorization` so duplicate callbacks lose the race, and keeps it for its FE
 * landing URL. Route must already reject IdP `error` params. On `invalid_client`, clears the stored
 * client so the next authorize re-registers (per-user tokens are left; there is usually none yet).
 */
export async function completeMcpAuthorization<TTransaction>(params: {
  tokenStore: IOAuthTokenStore<TTransaction>;
  mcpServerStore: IOAuthClientStore<TTransaction>;
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
      fetchFn: mcpOAuthFetch,
    });
  } catch (error: unknown) {
    if (error instanceof InvalidClientError) {
      await params.mcpServerStore.deleteClient({ id: pending.id });
      throw new McpConnectionError('OAuth client registration is invalid; please retry connecting', 400, {
        cause: error,
      });
    }
    throw mcpOAuthConnectionError('OAuth token exchange failed', error, 400);
  }
  await params.tokenStore.saveToken({
    id: pending.id,
    userRef: pending.userRef,
    token: oauthTokensToOAuthToken(tokens, nowMs, null),
  });
}
