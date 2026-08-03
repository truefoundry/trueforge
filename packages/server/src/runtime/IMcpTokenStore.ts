/**
 * Store contract for MCP OAuth state. Orchestration
 * (`ensureClientRegistered` / `buildAuthorizationUrl` / `resolveAuth`) stays outside.
 *
 * JSON payloads reuse the canonical DB column shapes in `db/mcpOAuthTypes.ts`.
 * Table keys (tenant, name, state) live on the method params / pending envelope,
 * not inside the JSONB blobs.
 */
import type { McpOAuthPendingAuthorizationData, McpOAuthToken, OAuthClient, OAuthServer } from '../db/mcpOAuthTypes';

/**
 * In-memory join of the two `mcp_server` OAuth columns written together at DCR.
 * Store implementations split/merge `OAuthClient` and `OAuthServer` at the DB boundary.
 */
export type McpOAuthClientRecord = OAuthClient & OAuthServer;

/**
 * Pending authorization for the store API: JSON `auth_data` plus row identity
 * (`state` = `oauth_pending_authorization.id`; tenant/server resolve the FK).
 */
export type McpOAuthPendingAuthorization = McpOAuthPendingAuthorizationData & {
  state: string;
  tenantId: string;
  serverName: string;
};

export interface IMcpTokenStore {
  saveOAuthClient(params: { tenantId: string; serverName: string; record: McpOAuthClientRecord }): Promise<void>;

  getOAuthClient(params: { tenantId: string; serverName: string }): Promise<McpOAuthClientRecord | undefined>;

  savePendingAuthorization(pending: McpOAuthPendingAuthorization): Promise<void>;

  getPendingAuthorization(params: { state: string }): Promise<McpOAuthPendingAuthorization | undefined>;

  saveToken(params: { tenantId: string; serverName: string; token: McpOAuthToken }): Promise<void>;

  getToken(params: { tenantId: string; serverName: string }): Promise<McpOAuthToken | undefined>;

  /** Drops the stored token only (keeps DCR client for re-authorization). */
  deleteToken(params: { tenantId: string; serverName: string }): Promise<void>;

  /** Clears client, token, and any pending row for (tenant, server). */
  delete(params: { tenantId: string; serverName: string }): Promise<void>;
}
