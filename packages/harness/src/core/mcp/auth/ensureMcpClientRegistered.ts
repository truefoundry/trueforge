/**
 * Ensures a DCR client exists for this MCP server id in the token store.
 */
import type { IMcpTokenStore } from './IMcpTokenStore';
import { createMcpOAuthClient } from './createMcpOAuthClient';
import { mcpOAuthCallbackUrl } from './mcpOAuthHelpers';
import type { McpOAuthClientRecord } from './types';

export async function ensureMcpClientRegistered(params: {
  tokenStore: IMcpTokenStore;
  serverId: string;
  mcpServerUrl: string;
  mcpServerName: string;
  publicBaseUrl: string;
  clientName: string;
}): Promise<McpOAuthClientRecord> {
  const existing = await params.tokenStore.getOAuthClient({ serverId: params.serverId });
  if (existing !== undefined) {
    return existing;
  }

  const record = await createMcpOAuthClient({
    mcpServerUrl: params.mcpServerUrl,
    mcpServerName: params.mcpServerName,
    redirectUri: mcpOAuthCallbackUrl(params.publicBaseUrl),
    clientName: params.clientName,
  });

  await params.tokenStore.saveOAuthClient({ serverId: params.serverId, record });
  return record;
}
