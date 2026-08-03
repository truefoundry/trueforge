/**
 * Shared MCP OAuth URL / client-metadata helpers.
 * Protocol work stays in the MCP SDK (`client/auth.js`).
 */
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { McpConnectionError } from '../../errors';
import type { McpOAuthClientRecord } from './types';

/** Fixed OAuth callback path for every MCP server (matches server mount). */
export const MCP_OAUTH_CALLBACK_PATH = '/api/v1/mcp-servers/oauth/callback';

/** OAuth callback redirect_uri = publicBaseUrl + fixed path. No trimming of the base. */
export function mcpOAuthCallbackUrl(publicBaseUrl: string): string {
  if (publicBaseUrl === '') {
    throw new McpConnectionError('PUBLIC_BASE_URL is required for MCP OAuth registration but was empty', 500);
  }
  return `${publicBaseUrl}${MCP_OAUTH_CALLBACK_PATH}`;
}

/** Client info for SDK token / authorize calls.
 * Same policy as servicefoundry outbound: form-body secret when present (client_secret_post),
 * otherwise public (none). Method is not stored on the client record.
 */
export function mcpClientInformation(client: McpOAuthClientRecord): OAuthClientInformationMixed {
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
export function mcpAuthorizationServerMetadata(client: McpOAuthClientRecord): AuthorizationServerMetadata {
  return {
    issuer: new URL(client.authorizationEndpoint).origin,
    authorization_endpoint: client.authorizationEndpoint,
    token_endpoint: client.tokenEndpoint,
    response_types_supported: ['code'],
    ...(client.codeChallengeMethodsSupported !== null
      ? { code_challenge_methods_supported: client.codeChallengeMethodsSupported }
      : {}),
  };
}

export function mcpAuthorizationServerOrigin(client: McpOAuthClientRecord): string {
  return new URL(client.authorizationEndpoint).origin;
}
