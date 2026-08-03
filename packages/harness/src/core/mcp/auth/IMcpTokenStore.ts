import type { McpOAuthClientRecord, McpOAuthPendingAuthorization, McpOAuthToken } from './types';

/**
 * Pure state store for MCP OAuth Dynamic Client Registration (RFC 7591). Orchestration
 * (`ensureMcpClientRegistered` / `buildMcpAuthorizationUrl` / `resolveMcpAuth` in `mcpDcr.ts`)
 * stays outside — this interface only persists and returns state.
 *
 * Keyed by `serverId` (`mcp_server.id`); `getPendingAuthorization`/`deletePendingAuthorization`
 * additionally key by the OAuth wire `state` param.
 */
export interface IMcpTokenStore {
  saveOAuthClient(params: { serverId: string; record: McpOAuthClientRecord }): Promise<void>;

  getOAuthClient(params: { serverId: string }): Promise<McpOAuthClientRecord | undefined>;

  savePendingAuthorization(pending: McpOAuthPendingAuthorization): Promise<void>;

  getPendingAuthorization(params: { state: string }): Promise<McpOAuthPendingAuthorization | undefined>;

  saveToken(params: { serverId: string; token: McpOAuthToken }): Promise<void>;

  getToken(params: { serverId: string }): Promise<McpOAuthToken | undefined>;

  /** Clears only the token (e.g. after a failed refresh, before re-authorizing). */
  deleteToken(params: { serverId: string }): Promise<void>;

  /** Clears client, token, and any pending authorization for this server. */
  delete(params: { serverId: string }): Promise<void>;
}
