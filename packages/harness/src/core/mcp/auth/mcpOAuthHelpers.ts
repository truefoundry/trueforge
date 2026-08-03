/**
 * Shared MCP OAuth URL / client-metadata helpers.
 * Protocol work stays in the MCP SDK (`client/auth.js`).
 */
import type { AuthorizationServerMetadata, OAuthClientInformation } from '@modelcontextprotocol/sdk/shared/auth.js';
import { McpConnectionError } from '../../errors';
import type { McpOAuthClientRecord } from './types';

/** Fixed OAuth callback path for every MCP server (matches /api/v1/mcp-servers/oauth router). */
export const MCP_OAUTH_CALLBACK_PATH = '/v1/mcp/oauth/callback';

/** OAuth callback redirect_uri = publicBaseUrl + fixed path. No trimming of the base. */
export function mcpOAuthCallbackUrl(publicBaseUrl: string): string {
  if (publicBaseUrl === '') {
    throw new McpConnectionError('PUBLIC_BASE_URL is required for MCP OAuth registration but was empty', 500);
  }
  return `${publicBaseUrl}${MCP_OAUTH_CALLBACK_PATH}`;
}

export function mcpClientInformation(client: McpOAuthClientRecord): OAuthClientInformation {
  return client.clientSecret !== undefined
    ? { client_id: client.clientId, client_secret: client.clientSecret }
    : { client_id: client.clientId };
}

/** Reconstruct AS metadata enough for startAuthorization / token calls. */
export function mcpAuthorizationServerMetadata(client: McpOAuthClientRecord): AuthorizationServerMetadata {
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

export function mcpAuthorizationServerOrigin(client: McpOAuthClientRecord): string {
  return new URL(client.authorizationEndpoint).origin;
}
