/**
 * Shared MCP OAuth URL / client-metadata helpers.
 * Protocol work stays in the MCP SDK (`client/auth.js`).
 */
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { OAuthClientCredentials, OAuthServerMetadata } from '../../auth/IOAuthClientStore';
import { McpConnectionError } from '../../errors';

/** Fixed OAuth callback path for every MCP server (matches server mount). */
export const MCP_OAUTH_CALLBACK_PATH = '/api/v1/mcp-servers/oauth/callback';

/**
 * OAuth callback redirect_uri = `PUBLIC_BASE_URL` + fixed path. No trimming of the base.
 * Reads from process env (same source as server config).
 */
export function mcpOAuthCallbackUrl(): string {
  const publicBaseUrl = process.env['PUBLIC_BASE_URL'] ?? '';
  if (publicBaseUrl === '') {
    throw new McpConnectionError('PUBLIC_BASE_URL is required for MCP OAuth registration but was empty', 500);
  }
  return `${publicBaseUrl}${MCP_OAUTH_CALLBACK_PATH}`;
}

/** Client info for SDK token / authorize calls.
 * Same policy as servicefoundry outbound: form-body secret when present (client_secret_post),
 * otherwise public (none). Method is not stored on the client record.
 */
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

/** Reconstruct authorization-server metadata enough for startAuthorization / token calls. */
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
