/**
 * Pure state store for OAuth Dynamic Client Registration (RFC 7591) — the generic parts only:
 * pending (PKCE) authorization and the access/refresh token. Deliberately excludes OAuth
 * client/server registration (`clientId`/`clientSecret`/AS endpoints) — that record currently
 * lives on `mcp_server` (MCP-specific DB row), so it stays out of this interface entirely; MCP's
 * own store (`core/mcp/auth/IMcpTokenStore`) owns that part and composes this one for the rest.
 * Keeping it out here, rather than folding it in and pretending it's generic, is what lets that
 * client/server storage move again later without touching this interface.
 *
 * Keyed by a single opaque `id` — the caller's own resource id (for MCP, `mcp_server.id`).
 * Tenant scoping and name→id resolution happen one layer up, wherever that id is first resolved.
 *
 * Store records use explicit `null` for absence, not `undefined` (see packages/harness/AGENTS.md).
 */

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

  /** Clears the token and any pending authorization for this resource. Client/server
   * registration is not this store's concern — see the module doc comment. */
  delete(params: { id: string }): Promise<void>;
}
