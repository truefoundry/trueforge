/**
 * Runtime shapes used by MCP OAuth helpers and {@link IMcpTokenStore}.
 * Not the DB source of truth — server column JSON lives in
 * `packages/server/src/db/mcpOAuthTypes.ts`.
 */

/** Discovered/cached authorization-server endpoints used by DCR and authorize. */
export interface McpOAuthClientRecord {
  clientId: string;
  clientSecret?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  codeChallengeMethodsSupported?: string[];
}

/** Access token returned by the authorization code exchange. */
export interface McpOAuthToken {
  accessToken: string;
  refreshToken?: string;
  /** ISO 8601 */
  expiresAt: string;
  scope?: string;
}

/**
 * Pending PKCE authorization. `state` is the OAuth `state` param / pending-row id;
 * `serverId` is the MCP server id.
 */
export interface McpOAuthPendingAuthorization {
  state: string;
  serverId: string;
  codeVerifier?: string;
  /** FE post-OAuth landing URL (not the OAuth redirect_uri). */
  redirectUrl?: string;
}
