/**
 * Shared MCP OAuth / DCR helpers.
 * HTTP/PKCE is delegated to `@modelcontextprotocol/sdk/client/auth.js`.
 */
import {
  discoverOAuthServerInfo,
  refreshAuthorization,
  registerClient,
  startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  AuthorizationServerMetadata,
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { McpConnectionError } from '@truefoundry/utils/core';
import { randomBytes } from 'node:crypto';
import type { IMcpTokenStore, McpOAuthClientRecord, McpOAuthToken } from './IMcpTokenStore';

export const MCP_OAUTH_CALLBACK_PATH = '/v1/mcp/oauth/callback';

const TOKEN_EXPIRY_BUFFER_MS = 60_000;

export interface McpOAuthRuntimeConfig {
  /** Public base URL of this server (trailing slash optional). */
  publicBaseUrl: string;
  /** RFC 7591 client_name shown on the authorization-server consent screen. */
  clientName: string;
}

/** ResolveAuth / authorize wire statuses (string values match API payloads). */
export enum McpAuthStatus {
  Authenticated = 'authenticated',
  AuthRequired = 'auth_required',
}

export type ResolveAuthResult =
  | { status: McpAuthStatus.Authenticated; headers: Record<string, string> }
  | { status: McpAuthStatus.AuthRequired; authUrl: string };

export function oauthCallbackUrl(publicBaseUrl: string): string {
  const base = publicBaseUrl.trim().replace(/\/+$/, '');
  if (base === '') {
    throw new McpConnectionError('PUBLIC_BASE_URL is required for MCP OAuth registration but was empty', 500);
  }
  return `${base}${MCP_OAUTH_CALLBACK_PATH}`;
}

/** RFC 8707 resource: lowercase scheme + host, no fragment. */
export function normalizeResourceUri(serverUrl: string): URL {
  const url = new URL(serverUrl);
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';
  return url;
}

function clientInformation(client: McpOAuthClientRecord): OAuthClientInformation {
  return client.clientSecret !== undefined
    ? { client_id: client.clientId, client_secret: client.clientSecret }
    : { client_id: client.clientId };
}

/** Minimal AS metadata reconstruction from the stored client record. */
function getMetadataFromClient(client: McpOAuthClientRecord): AuthorizationServerMetadata {
  return {
    issuer: new URL(client.authorizationEndpoint).origin,
    authorization_endpoint: client.authorizationEndpoint,
    token_endpoint: client.tokenEndpoint,
    response_types_supported: ['code'],
    ...(client.codeChallengeMethodsSupported !== undefined
      ? { code_challenge_methods_supported: client.codeChallengeMethodsSupported }
      : {}),
  };
}

function getOriginFromClient(client: McpOAuthClientRecord): string {
  return new URL(client.authorizationEndpoint).origin;
}

function isExpired(token: McpOAuthToken): boolean {
  return token.expiresAt.getTime() <= Date.now() + TOKEN_EXPIRY_BUFFER_MS;
}

function toStoredToken(result: OAuthTokens, previousRefreshToken: string | undefined): McpOAuthToken {
  const now = Date.now();
  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token ?? previousRefreshToken,
    // Missing expires_in → already expired so the next resolveAuth re-checks.
    expiresAt: result.expires_in !== undefined ? new Date(now + result.expires_in * 1000) : new Date(now),
    scope: result.scope,
  };
}

async function registerClientWithPublicRetry(
  authorizationServerUrl: string,
  metadata: AuthorizationServerMetadata,
  clientMetadata: OAuthClientMetadata,
  serverName: string,
): Promise<OAuthClientInformationFull> {
  try {
    return await registerClient(authorizationServerUrl, { metadata, clientMetadata });
  } catch (firstError: unknown) {
    try {
      // Retry without token_endpoint_auth_method for Authorization Servers that only issue public clients.
      const publicClient: OAuthClientMetadata = {
        client_name: clientMetadata.client_name,
        redirect_uris: clientMetadata.redirect_uris,
        grant_types: clientMetadata.grant_types,
        response_types: clientMetadata.response_types,
      };
      return await registerClient(authorizationServerUrl, {
        metadata,
        clientMetadata: publicClient,
      });
    } catch (secondError: unknown) {
      throw new McpConnectionError(`Failed to dynamically register OAuth client for MCP server '${serverName}'`, 502, {
        cause: secondError instanceof Error ? secondError : firstError,
      });
    }
  }
}

/** Returns a cached DCR client, or discovers + registers and persists one. */
export async function ensureClientRegistered(params: {
  tokenStore: IMcpTokenStore;
  tenantId: string;
  serverName: string;
  serverUrl: string;
  config: McpOAuthRuntimeConfig;
}): Promise<McpOAuthClientRecord> {
  const { tokenStore, tenantId, serverName, serverUrl, config } = params;

  const existing = await tokenStore.getOAuthClient({ tenantId, serverName });
  // TODO: later down the line we should allow a override to re-register the client
  if (existing !== undefined) {
    return existing;
  }

  const redirectUri = oauthCallbackUrl(config.publicBaseUrl);
  const { authorizationServerUrl, authorizationServerMetadata: metadata } = await discoverOAuthServerInfo(serverUrl);

  if (metadata?.registration_endpoint === undefined) {
    throw new McpConnectionError(
      `MCP server '${serverName}' has no DCR support (missing registration_endpoint); auth.type: dcr is misconfigured for this server`,
      400,
    );
  }

  const fullInfo = await registerClientWithPublicRetry(
    authorizationServerUrl,
    metadata,
    {
      client_name: config.clientName,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
    },
    serverName,
  );

  if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new McpConnectionError(
      `Authorization server for MCP server '${serverName}' is missing authorization_endpoint or token_endpoint`,
      502,
    );
  }

  const record: McpOAuthClientRecord = {
    clientId: fullInfo.client_id,
    clientSecret: fullInfo.client_secret,
    authorizationEndpoint: metadata.authorization_endpoint,
    tokenEndpoint: metadata.token_endpoint,
    codeChallengeMethodsSupported: metadata.code_challenge_methods_supported,
  };

  await tokenStore.saveOAuthClient({ tenantId, serverName, record });
  return record;
}

/** Builds a PKCE authorization URL and stores the pending authorization. */
export async function buildAuthorizationUrl(params: {
  tokenStore: IMcpTokenStore;
  tenantId: string;
  serverName: string;
  serverUrl: string;
  config: McpOAuthRuntimeConfig;
  redirectUrl: string | undefined;
}): Promise<string> {
  const { tokenStore, tenantId, serverName, serverUrl, config, redirectUrl } = params;
  const client = await ensureClientRegistered({
    tokenStore,
    tenantId,
    serverName,
    serverUrl,
    config,
  });

  const state = randomBytes(32).toString('base64url');
  const { authorizationUrl, codeVerifier } = await startAuthorization(getOriginFromClient(client), {
    metadata: getMetadataFromClient(client),
    clientInformation: clientInformation(client),
    redirectUrl: oauthCallbackUrl(config.publicBaseUrl),
    resource: normalizeResourceUri(serverUrl),
    state,
  });

  await tokenStore.savePendingAuthorization({
    state,
    tenantId,
    serverName,
    codeVerifier,
    redirectUrl,
  });

  return authorizationUrl.toString();
}

/**
 * Resolve bearer headers for a DCR-backed MCP server, or return an authorization
 * URL when the human must (re)connect. Hard failures throw; auth_required means
 * "give the human a link".
 */
export async function resolveAuth(params: {
  tokenStore: IMcpTokenStore;
  serverId: string;
  serverName: string;
  tenantId: string;
  serverUrl: string;
  config: McpOAuthRuntimeConfig;
}): Promise<ResolveAuthResult> {
  void params.serverId;
  const { tokenStore, tenantId, serverName, serverUrl, config } = params;

  const token = await tokenStore.getToken({ tenantId, serverName });

  if (token !== undefined && !isExpired(token)) {
    return {
      status: McpAuthStatus.Authenticated,
      headers: { Authorization: `Bearer ${token.accessToken}` },
    };
  }

  if (token?.refreshToken !== undefined) {
    const client = await tokenStore.getOAuthClient({ tenantId, serverName });
    if (client !== undefined) {
      try {
        const result = await refreshAuthorization(getOriginFromClient(client), {
          metadata: getMetadataFromClient(client),
          clientInformation: clientInformation(client),
          refreshToken: token.refreshToken,
          resource: normalizeResourceUri(serverUrl),
        });
        await tokenStore.saveToken({
          tenantId,
          serverName,
          token: toStoredToken(result, token.refreshToken),
        });
        return {
          status: McpAuthStatus.Authenticated,
          headers: { Authorization: `Bearer ${result.access_token}` },
        };
      } catch {
        // any refresh failure → re-authorize
      }
    }
  }

  const authUrl = await buildAuthorizationUrl({
    tokenStore,
    tenantId,
    serverName,
    serverUrl,
    config,
    redirectUrl: undefined,
  });
  return { status: McpAuthStatus.AuthRequired, authUrl };
}
