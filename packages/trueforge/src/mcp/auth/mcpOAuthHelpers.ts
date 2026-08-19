import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { McpConnectionError } from '@truefoundry/trueforge-core/core';
import { getPublicBaseUrl } from '../../config';
import type { OAuthClientCredentials, OAuthServerMetadata, OAuthToken } from './types';

/** Fixed OAuth callback path for every MCP server. */
export const MCP_OAUTH_CALLBACK_PATH = '/api/v1/mcp-servers/oauth/callback';

/** Fallback TTL when an RFC 6749 token response omits `expires_in`. */
export const DEFAULT_MCP_ACCESS_TOKEN_TTL_SECONDS = 3600;

/** Builds the server-owned MCP OAuth callback URL. */
export function mcpOAuthCallbackUrl(): string {
  try {
    const publicBaseUrl = getPublicBaseUrl();
    return `${publicBaseUrl}${MCP_OAUTH_CALLBACK_PATH}`;
  } catch (error) {
    throw new McpConnectionError('PUBLIC_BASE_URL is required for MCP OAuth registration but was empty', 500, {
      cause: error,
    });
  }
}

/** Uses form-body client authentication when a secret is present. */
export function mcpClientInformation(client: OAuthClientCredentials): OAuthClientInformationMixed {
  return client.clientSecret !== null
    ? {
        client_id: client.clientId,
        client_secret: client.clientSecret,
        token_endpoint_auth_method: 'client_secret_post',
      }
    : {
        client_id: client.clientId,
        token_endpoint_auth_method: 'none',
      };
}

/** Reconstructs the metadata required by the MCP SDK authorization helpers. */
export function mcpAuthorizationServerMetadata(server: OAuthServerMetadata): AuthorizationServerMetadata {
  return {
    issuer: new URL(server.authorizationEndpoint).origin,
    authorization_endpoint: server.authorizationEndpoint,
    token_endpoint: server.tokenEndpoint,
    response_types_supported: ['code'],
    ...(server.codeChallengeMethodsSupported !== null
      ? { code_challenge_methods_supported: server.codeChallengeMethodsSupported }
      : {}),
  };
}

export function mcpAuthorizationServerOrigin(server: OAuthServerMetadata): string {
  return new URL(server.authorizationEndpoint).origin;
}

export function oauthTokensToOAuthToken(
  tokens: OAuthTokens,
  nowMs: number,
  fallbackRefreshToken: string | null,
): OAuthToken {
  const expiresInSeconds = tokens.expires_in ?? DEFAULT_MCP_ACCESS_TOKEN_TTL_SECONDS;
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? fallbackRefreshToken,
    expiresAt: new Date(nowMs + expiresInSeconds * 1000).toISOString(),
    scope: tokens.scope ?? null,
  };
}

/** True when the expiry parses and is strictly in the future. */
export function isOAuthAccessTokenUsable(expiresAtIso: string, nowMs: number): boolean {
  const expiresAtMs = Date.parse(expiresAtIso);
  return !Number.isNaN(expiresAtMs) && expiresAtMs > nowMs;
}
