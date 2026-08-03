/**
 * Dynamic Client Registration (RFC 7591) for an MCP server's authorization server.
 * No store I/O — pure network + mapping to McpOAuthClientRecord.
 */
import { discoverOAuthServerInfo, registerClient } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationFull,
  OAuthClientMetadata,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { McpConnectionError } from '../../errors';
import type { McpOAuthClientRecord } from './types';

/**
 * `token_endpoint_auth_method: client_secret_post` first: prefer a confidential
 * (client_secret) registration when the AS allows it. Many MCP ASes only issue
 * public clients — those reject the first attempt; we retry once without the field
 * (RFC 7591 public client / no auth method). Not a loop, one retry, then surface.
 */
async function registerMcpClientWithPublicRetry(
  authorizationServerUrl: string,
  metadata: AuthorizationServerMetadata,
  clientMetadata: OAuthClientMetadata,
  serverName: string,
): Promise<OAuthClientInformationFull> {
  try {
    return await registerClient(authorizationServerUrl, { metadata, clientMetadata });
  } catch (firstError: unknown) {
    try {
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

/**
 * Discover the AS for `mcpServerUrl`, require DCR, register a client, return the
 * joined OAuthClient+OAuthServer record (not yet persisted).
 */
export async function createMcpOAuthClient(params: {
  mcpServerUrl: string;
  /** Display name for error messages only. */
  mcpServerName: string;
  redirectUri: string;
  clientName: string;
}): Promise<McpOAuthClientRecord> {
  const { mcpServerUrl, mcpServerName, redirectUri, clientName } = params;

  const { authorizationServerUrl, authorizationServerMetadata: metadata } = await discoverOAuthServerInfo(mcpServerUrl);

  if (metadata?.registration_endpoint === undefined) {
    throw new McpConnectionError(
      `MCP server '${mcpServerName}' has no DCR support (missing registration_endpoint); auth.type: dcr is misconfigured for this server`,
      400,
    );
  }

  // No refresh_token grant — access tokens are re-obtained via full browser auth.
  //
  // token_endpoint_auth_method: start as confidential client (secret posted at
  // the token endpoint). This is a preference, not metadata negotiation — many
  // MCP authorization servers only mint public clients and reject this DCR
  // shape; registerMcpClientWithPublicRetry then retries once omitting the
  // field (public client / no client authentication method).
  const fullInfo = await registerMcpClientWithPublicRetry(
    authorizationServerUrl,
    metadata,
    {
      client_name: clientName,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
    },
    mcpServerName,
  );

  if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new McpConnectionError(
      `Authorization server for MCP server '${mcpServerName}' is missing authorization_endpoint or token_endpoint`,
      502,
    );
  }

  return {
    clientId: fullInfo.client_id,
    clientSecret: fullInfo.client_secret ?? null,
    authorizationEndpoint: metadata.authorization_endpoint,
    tokenEndpoint: metadata.token_endpoint,
    codeChallengeMethodsSupported: metadata.code_challenge_methods_supported ?? null,
  };
}
