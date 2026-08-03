/**
 * This is temporary interface only, will change
 */

/** Registered OAuth client for one MCP server under one tenant. */
export interface McpOAuthClientRecord {
  clientId: string;
  /** Presence selects confidential-client auth; omit for public clients. */
  clientSecret: string | undefined;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** Cached from AS metadata at registration; drives PKCE checks without re-discovery. */
  codeChallengeMethodsSupported: string[] | undefined;
}

/** In-flight authorization awaiting the OAuth callback (keyed by CSRF `state`). */
export interface McpOAuthPendingAuthorization {
  state: string;
  tenantId: string;
  serverName: string;
  /** Absent when the authorization server does not advertise PKCE support. */
  codeVerifier: string | undefined;
  /** FE landing URL after OAuth completes; not the OAuth redirect_uri. */
  redirectUrl: string | undefined;
}

/** Stored access token for one MCP server under one tenant. */
export interface McpOAuthToken {
  accessToken: string;
  refreshToken: string | undefined;
  /** Absolute expiry; treat missing expiry at write time as already-expired. */
  expiresAt: Date;
  scope: string | undefined;
}

/**
 * Pure state store for MCP OAuth. Orchestration
 * (`ensureClientRegistered` / `buildAuthorizationUrl` / `resolveAuth`) stays outside.
 */
export interface IMcpTokenStore {
  saveOAuthClient(params: { tenantId: string; serverName: string; record: McpOAuthClientRecord }): Promise<void>;

  getOAuthClient(params: { tenantId: string; serverName: string }): Promise<McpOAuthClientRecord | undefined>;

  savePendingAuthorization(pending: McpOAuthPendingAuthorization): Promise<void>;

  getPendingAuthorization(params: { state: string }): Promise<McpOAuthPendingAuthorization | undefined>;

  saveToken(params: { tenantId: string; serverName: string; token: McpOAuthToken }): Promise<void>;

  getToken(params: { tenantId: string; serverName: string }): Promise<McpOAuthToken | undefined>;

  /** Clears client, token, and any pending row for (tenant, server). */
  delete(params: { tenantId: string; serverName: string }): Promise<void>;
}
