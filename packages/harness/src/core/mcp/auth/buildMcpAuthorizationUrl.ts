/**
 * Builds a PKCE authorization URL for an MCP server and persists pending auth
 * keyed by OAuth `state` (= oauth_pending_authorization.id).
 */
import { startAuthorization } from '@modelcontextprotocol/sdk/client/auth.js';
import { resourceUrlFromServerUrl } from '@modelcontextprotocol/sdk/shared/auth-utils.js';
import { randomBytes } from 'node:crypto';
import type { IMcpTokenStore } from './IMcpTokenStore';
import { ensureMcpClientRegistered } from './ensureMcpClientRegistered';
import {
  mcpAuthorizationServerMetadata,
  mcpAuthorizationServerOrigin,
  mcpClientInformation,
  mcpOAuthCallbackUrl,
} from './mcpOAuthHelpers';

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
