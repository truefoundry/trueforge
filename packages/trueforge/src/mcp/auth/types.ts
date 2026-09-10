/** In-flight authorization awaiting the OAuth callback (keyed by CSRF `state`). */
export interface OAuthPendingAuthorization {
  state: string;
  id: string;
  userRef: string;
  mcpServerUrl: string;
  codeVerifier: string | null;
  returnTo: string | null;
}

/** Stored access token for one (MCP server, user) pair. */
export interface OAuthToken {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  scope: string | null;
}

/** Composite key: MCP server row id + harness `RequestContext.subject.id`. */
export interface OAuthTokenKey {
  id: string;
  userRef: string;
}

export interface IOAuthTokenStore<TTransaction = never> {
  savePendingAuthorization(pending: OAuthPendingAuthorization, transaction?: TTransaction): Promise<void>;
  consumePendingAuthorization(
    params: { state: string },
    transaction?: TTransaction,
  ): Promise<OAuthPendingAuthorization | undefined>;
  saveToken(params: OAuthTokenKey & { token: OAuthToken }, transaction?: TTransaction): Promise<void>;
  getToken(params: OAuthTokenKey, transaction?: TTransaction): Promise<OAuthToken | undefined>;
  getTokens(params: { ids: string[]; userRef: string }, transaction?: TTransaction): Promise<Map<string, OAuthToken>>;
  deleteToken(params: OAuthTokenKey, transaction?: TTransaction): Promise<void>;
  /** Deletes every per-user token for one MCP server id (all users). */
  deleteTokensForServer(params: { id: string }, transaction?: TTransaction): Promise<void>;
  /** Deletes every in-flight authorization for one MCP server id (all users). */
  deletePendingAuthorizationsForServer(params: { id: string }, transaction?: TTransaction): Promise<void>;
}

/** Authorization-server endpoints discovered and cached at registration time. */
export interface OAuthServerMetadata {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  codeChallengeMethodsSupported: string[] | null;
}

/** Credentials for a dynamically registered client. */
export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string | null;
}

export interface OAuthClientRecord {
  server: OAuthServerMetadata;
  client: OAuthClientCredentials;
}

export interface IOAuthClientStore<TTransaction = never> {
  saveClient(params: { id: string; record: OAuthClientRecord }, transaction?: TTransaction): Promise<void>;
  getClient(params: { id: string }, transaction?: TTransaction): Promise<OAuthClientRecord | undefined>;
  deleteClient(params: { id: string }, transaction?: TTransaction): Promise<void>;
}

export interface McpAuthResolvedResult {
  headers: Record<string, string>;
}

export interface McpAuthRequiredResult {
  authUrl: URL;
}

export type ResolveMcpAuthResult = McpAuthResolvedResult | McpAuthRequiredResult;
