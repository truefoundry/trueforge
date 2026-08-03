/**
 * Canonical JSON shapes for MCP OAuth columns (`mcp_server`, `oauth_token`,
 * `oauth_pending_authorization`). Owned by the server DB layer — not the harness.
 */

// Absence is an explicit `| null`, not an optional `?:`

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
