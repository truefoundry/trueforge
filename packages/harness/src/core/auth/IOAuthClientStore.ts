/**
 * Pure state store for a registered OAuth Dynamic Client Registration (RFC 7591) client, plus
 * the authorization-server endpoints cached alongside it at registration time. Generic — not
 * MCP-specific — even though the only current caller (MCP) happens to persist this on
 * `mcp_server.oauth_server` / `.oauth_client` rather than a dedicated table; that's a DB-layer
 * detail, not something this interface knows about.
 *
 * The stored value is deliberately two distinct halves rather than one flat bag: the
 * authorization server (`server`, from discovery) and the registered client (`client`, from the
 * DCR response). They come from different HTTP responses and only `client` carries a secret, so
 * they map 1:1 to the two DB columns (`oauth_server` / `oauth_client`).
 *
 * Keyed by the same opaque `id` as `IOAuthTokenStore` — the caller's own resource id. A single
 * concrete store commonly implements both interfaces (see `core/mcp/auth/mcpDcr.ts`, which takes
 * one param typed as `IOAuthTokenStore & IOAuthClientStore` rather than a combined named type).
 *
 * Store records use explicit `null` for absence, not `undefined` (see packages/harness/AGENTS.md).
 */

/** Authorization-server endpoints, discovered and cached at registration time (mirrors `oauth_server`). */
export interface OAuthServerMetadata {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  codeChallengeMethodsSupported: string[] | null;
}

/** Credentials for a dynamically-registered client, RFC 7591 (mirrors `oauth_client`). */
export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string | null;
}

/**
 * A client registered against a specific authorization server — the two halves the DCR flow
 * produces, kept distinct because they come from different responses (discovery vs registration)
 * and only `client` carries a secret.
 */
export interface OAuthClientRegistration {
  server: OAuthServerMetadata;
  client: OAuthClientCredentials;
}

export interface IOAuthClientStore {
  saveClient(params: { id: string; registration: OAuthClientRegistration }): Promise<void>;

  getClient(params: { id: string }): Promise<OAuthClientRegistration | undefined>;

  deleteClient(params: { id: string }): Promise<void>;
}
