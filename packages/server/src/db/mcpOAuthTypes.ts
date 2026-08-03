/**
 * Canonical JSON shapes for MCP OAuth columns (`mcp_server`, `oauth_token`,
 * `oauth_pending_authorization`). Owned by the server DB layer — not the harness.
 */

// Absence is an explicit `| null`, not an optional `?:` — matching the session-store JSON blob
// convention (see db/*/types.ts blob interfaces) and packages/harness/AGENTS.md. This makes these
// row shapes structurally line up with the harness domain types (`OAuthToken` etc., also `| null`),
// so the query-layer mapping is a straight field copy with no null<->undefined bridging.

/** RFC 8414 AS metadata cached at DCR time (`mcp_server.oauth_server`). */
export interface OAuthServer {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  codeChallengeMethodsSupported: string[] | null;
}

/** RFC 7591 DCR response (`mcp_server.oauth_client`). */
export interface OAuthClient {
  clientId: string;
  clientSecret: string | null;
}

/** `oauth_pending_authorization.auth_data` JSONB. */
export interface McpOAuthPendingAuthorizationData {
  codeVerifier: string | null;
  redirectUrl: string | null;
}

/** `oauth_token.token` JSONB. */
export interface McpOAuthToken {
  accessToken: string;
  refreshToken: string | null;
  /** ISO 8601 */
  expiresAt: string;
  scope: string | null;
}

/** Joined view of oauth_client + oauth_server (written together at DCR). */
export type McpOAuthClientRecord = OAuthClient & OAuthServer;

/**
 * Pending auth envelope for store APIs.
 * `state` is `oauth_pending_authorization.id` (OAuth wire `state`).
 * `serverId` is `mcp_server.id` / `oauth_server_id` FK.
 */
export type McpOAuthPendingAuthorization = McpOAuthPendingAuthorizationData & {
  state: string;
  serverId: string;
};
