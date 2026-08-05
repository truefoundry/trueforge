/** In-flight authorization awaiting the OAuth callback (keyed by CSRF `state`). */
export interface OAuthPendingAuthorization {
  state: string;
  id: string;
  mcpServerUrl: string;
  codeVerifier: string | null;
  redirectUrl: string | null;
}

/** Stored access token for one resource. */
export interface OAuthToken {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  scope: string | null;
}

export interface IOAuthTokenStore {
  savePendingAuthorization(pending: OAuthPendingAuthorization): Promise<void>;
  consumePendingAuthorization(params: { state: string }): Promise<OAuthPendingAuthorization | undefined>;
  saveToken(params: { id: string; token: OAuthToken }): Promise<void>;
  getToken(params: { id: string }): Promise<OAuthToken | undefined>;
  getTokens(params: { ids: string[] }): Promise<Map<string, OAuthToken>>;
  deleteToken(params: { id: string }): Promise<void>;
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

export interface IOAuthClientStore {
  saveClient(params: { id: string; record: OAuthClientRecord }): Promise<void>;
  getClient(params: { id: string }): Promise<OAuthClientRecord | undefined>;
  deleteClient(params: { id: string }): Promise<void>;
}

export interface McpAuthResolvedResult {
  headers: Record<string, string>;
}

export interface McpAuthRequiredResult {
  authUrl: URL;
}

export type ResolveMcpAuthResult = McpAuthResolvedResult | McpAuthRequiredResult;
