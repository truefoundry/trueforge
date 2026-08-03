/**
 * Pure state store for a registered OAuth Dynamic Client Registration (RFC 7591) client, plus
 * the authorization-server endpoints cached alongside it at registration time. Generic — not
 * MCP-specific — even though the only current caller (MCP) happens to persist this on
 * `mcp_server.oauth_server` / `.oauth_client` rather than a dedicated table; that's a DB-layer
 * detail, not something this interface knows about.
 *
 * Keyed by the same opaque `id` as `IOAuthTokenStore` — the caller's own resource id. A single
 * concrete store commonly implements both interfaces (see `core/mcp/auth/mcpDcr.ts`, which takes
 * one param typed as `IOAuthTokenStore & IOAuthClientStore` rather than a combined named type).
 *
 * Store records use explicit `null` for absence, not `undefined` (see packages/harness/AGENTS.md).
 */

export interface OAuthClientRecord {
  clientId: string;
  clientSecret: string | null;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  codeChallengeMethodsSupported: string[] | null;
}

export interface IOAuthClientStore {
  saveClient(params: { id: string; record: OAuthClientRecord }): Promise<void>;

  getClient(params: { id: string }): Promise<OAuthClientRecord | undefined>;

  deleteClient(params: { id: string }): Promise<void>;
}
