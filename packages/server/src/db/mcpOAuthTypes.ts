/**
 * Canonical JSON shapes for MCP OAuth columns. Owned here so Postgres/SQLite table
 * typing and runtime orchestration share one definition (no dual postgres/sqlite copies).
 */

/**
 * `mcp_server.oauth_server` JSONB shape — RFC 8414 authorization-server metadata,
 * discovered once at registration time. Own column, not merged with oauth_client:
 * different source HTTP call (metadata discovery vs. DCR registration), and this one
 * never carries a secret.
 */
export interface OAuthServer {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  codeChallengeMethodsSupported?: string[];
}

/** `mcp_server.oauth_client` JSONB shape — RFC 7591 DCR registration response for this server. */
export interface OAuthClient {
  clientId: string;
  clientSecret?: string;
}

/** `oauth_pending_authorization.auth_data` JSONB shape. */
export interface McpOAuthPendingAuthorizationData {
  /** absent when the authorization server doesn't advertise PKCE support */
  codeVerifier?: string;
  /** absent when triggered mid-turn by resolveAuth, not by the authorize() endpoint */
  redirectUrl?: string;
}

/** `oauth_token.token` JSONB shape — matches SF's MCPUserAuthModel.authData. */
export interface McpOAuthToken {
  accessToken: string;
  /** absent: some grants don't issue one */
  refreshToken?: string;
  /** ISO 8601; always filled — see "missing expires_in" fallback in the design doc */
  expiresAt: string;
  /** scope is a single space-delimited case-sensitive string, not a list. */
  scope?: string;
}
