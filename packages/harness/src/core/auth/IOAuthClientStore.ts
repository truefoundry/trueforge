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
export interface OAuthClientRecord {
  server: OAuthServerMetadata;
  client: OAuthClientCredentials;
}

/**
 * OAuth client registration columns on an MCP server row (`oauth_server` + `oauth_client`).
 * Implemented by the MCP server store — not a separate persistence root.
 */
export interface IOAuthClientStore {
  saveClient(params: { id: string; record: OAuthClientRecord }): Promise<void>;

  getClient(params: { id: string }): Promise<OAuthClientRecord | undefined>;

  /** Drop a stale registration so the next authorize can re-run DCR (e.g. invalid_client). */
  deleteClient(params: { id: string }): Promise<void>;
}
