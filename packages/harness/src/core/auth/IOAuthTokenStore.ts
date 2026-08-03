/**
 * Pure state store for OAuth Dynamic Client Registration (RFC 7591). Not MCP-specific — any
 * resource that authenticates via DCR can use this; the MCP orchestration
 * (`ensureClientRegistered` / `buildAuthorizationUrl` / `resolveAuth` in
 * `core/mcp/auth/mcpOAuth.ts`) is one caller, not the owner of this contract. Follows the
 * `ISessionStore` house style (pure state store + separate orchestration).
 *
 * Keyed by a single opaque `id` — the caller's own resource id (for MCP, `mcp_server.id`), not a
 * (tenant, name) pair. Tenant scoping happens one layer up, wherever that id is first resolved;
 * this store and its backing tables never need to know about tenants or names at all.
 *
 * Field shapes here intentionally mirror `db/postgres/types.ts`'s `OAuthServer` / `OAuthClient` /
 * `OAuthToken` / `OAuthPendingAuthorizationData` in `packages/server` 1:1, so a Kysely-backed
 * implementation is a straight passthrough with no field-by-field remapping.
 */

/**
 * Authorization-server metadata, discovered once at registration time.
 */
export interface OAuthServer {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** Drives the PKCE decision without re-discovery. */
  codeChallengeMethodsSupported?: string[];
}

/** DCR registration response for this resource. */
export interface OAuthClient {
  clientId: string;
  clientSecret?: string;
}

/** In-flight authorization awaiting the OAuth callback (keyed by CSRF `state`). */
export interface OAuthPendingAuthorization {
  /** The resource this pending authorization is for — same `server_id` used everywhere else in this
   * interface. */
  server_id: string;
  /** The OAuth wire `state` param. */
  state: string;
  /** Absent when the authorization server does not advertise PKCE support. */
  codeVerifier?: string;
  /** FE landing URL after OAuth completes; not the OAuth redirect_uri. */
  redirectUrl?: string;
}

/** Stored access token for one resource. */
export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  /** Absolute expiry; treat missing expiry at write time as already-expired, not never-expiring. */
  expiresAt: Date;
  /** Space-delimited, single string. */
  scope?: string;
}

export interface IOAuthTokenStore {
  savePendingAuthorization(pending: OAuthPendingAuthorization): Promise<void>;

  getPendingAuthorization(params: { state: string }): Promise<OAuthPendingAuthorization | undefined>;

  saveToken(params: { server_id: string; token: OAuthToken }): Promise<void>;

  getToken(params: { server_id: string }): Promise<OAuthToken | undefined>;

  /** Clears token and pending authorization for this resource. */
  delete(params: { server_id: string }): Promise<void>;
}
