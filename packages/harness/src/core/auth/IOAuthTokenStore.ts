/** In-flight authorization awaiting the OAuth callback (keyed by CSRF `state`). */
export interface OAuthPendingAuthorization {
  /** The OAuth wire `state` param — also this store's lookup key for the pending row. */
  state: string;
  /** The resource this pending authorization is for — same `id` used everywhere else here. */
  id: string;
  /**
   * MCP server URL used at authorize time. The shared OAuth callback only receives `state`/`code`,
   * so this is stashed so token exchange can rebuild the same RFC 8707 `resource`.
   */
  mcpServerUrl: string;
  /** `null` when the authorization server does not advertise PKCE support. */
  codeVerifier: string | null;
  /** FE landing URL after OAuth completes; not the OAuth redirect_uri. `null` when unset. */
  redirectUrl: string | null;
}

/** Stored access token for one resource. */
export interface OAuthToken {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  /** Space-delimited, single string. `null` when unset. */
  scope: string | null;
}

export interface IOAuthTokenStore {
  savePendingAuthorization(pending: OAuthPendingAuthorization): Promise<void>;

  /**
   * Atomically load and delete a pending authorization for `state` so a callback can be redeemed
   * only once (safe under concurrent duplicate redirects). Past-TTL rows are never returned
   * (same rule as a pure read would apply); the TTL itself is the implementation's to choose.
   */
  consumePendingAuthorization(params: { state: string }): Promise<OAuthPendingAuthorization | undefined>;

  saveToken(params: { id: string; token: OAuthToken }): Promise<void>;

  getToken(params: { id: string }): Promise<OAuthToken | undefined>;

  deleteToken(params: { id: string }): Promise<void>;
}
