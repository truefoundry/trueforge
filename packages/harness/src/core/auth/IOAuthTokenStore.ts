/** In-flight authorization awaiting the OAuth callback (keyed by CSRF `state`). */
export interface OAuthPendingAuthorization {
  /** The OAuth wire `state` param — also this store's lookup key for the pending row. */
  state: string;
  /** The resource this pending authorization is for — same `id` used everywhere else here. */
  id: string;
  /** `null` when the authorization server does not advertise PKCE support. */
  codeVerifier: string | null;
  /** FE landing URL after OAuth completes; not the OAuth redirect_uri. `null` when unset. */
  redirectUrl: string | null;
}

/** Stored access token for one resource. */
export interface OAuthToken {
  accessToken: string;
  refreshToken: string | null;
  /** ISO 8601. Treat missing expiry at write time as already-expired, not never-expiring. */
  expiresAt: string;
  /** Space-delimited, single string. `null` when unset. */
  scope: string | null;
}

export interface IOAuthTokenStore {
  savePendingAuthorization(pending: OAuthPendingAuthorization): Promise<void>;

  getPendingAuthorization(params: { state: string }): Promise<OAuthPendingAuthorization | undefined>;

  saveToken(params: { id: string; token: OAuthToken }): Promise<void>;

  getToken(params: { id: string }): Promise<OAuthToken | undefined>;

  /** Clears only the token (e.g. after a failed refresh, before re-authorizing). */
  deleteToken(params: { id: string }): Promise<void>;

  /** Clears the token and any pending authorization for this resource. */
  delete(params: { id: string }): Promise<void>;
}
