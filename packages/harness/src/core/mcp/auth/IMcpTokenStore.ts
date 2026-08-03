/**
 * Pure state store for MCP OAuth. One logical (server) row set keyed by mcp_server.id.
 * Implementations: Postgres/SQLite later; InMemory for tests/dev.
 */
import type { McpOAuthClientRecord, McpOAuthPendingAuthorization, McpOAuthToken } from './types';

export interface IMcpTokenStore {
  saveOAuthClient(params: { serverId: string; record: McpOAuthClientRecord }): Promise<void>;

  getOAuthClient(params: { serverId: string }): Promise<McpOAuthClientRecord | undefined>;

  savePendingAuthorization(pending: McpOAuthPendingAuthorization): Promise<void>;

  getPendingAuthorization(params: { state: string }): Promise<McpOAuthPendingAuthorization | undefined>;

  saveToken(params: { serverId: string; token: McpOAuthToken }): Promise<void>;

  getToken(params: { serverId: string }): Promise<McpOAuthToken | undefined>;

  /** Drops token only (keeps DCR client for re-authorization). */
  deleteToken(params: { serverId: string }): Promise<void>;

  /** Clears client, token, and pending rows for this MCP server id. */
  delete(params: { serverId: string }): Promise<void>;
}
