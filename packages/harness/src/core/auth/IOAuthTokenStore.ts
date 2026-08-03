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
  expiresAt: string;
  /** Space-delimited, single string. `null` when unset. */
  scope: string | null;
}

export interface IOAuthTokenStore {
  savePendingAuthorization(pending: OAuthPendingAuthorization): Promise<void>;

  /**
   * Expires on read: a pending authorization past its age limit is never returned, so nothing
   * has to sweep the store. The limit itself is the implementation's to choose.
   */
  getPendingAuthorization(params: { state: string }): Promise<OAuthPendingAuthorization | undefined>;

  /** Makes `state` single-use — call once the callback has been redeemed or abandoned. */
  deletePendingAuthorization(params: { state: string }): Promise<void>;

  saveToken(params: { id: string; token: OAuthToken }): Promise<void>;

  getToken(params: { id: string }): Promise<OAuthToken | undefined>;

  deleteToken(params: { id: string }): Promise<void>;
}
