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

export interface IOAuthClientStore {
  saveClient(params: { id: string; record: OAuthClientRecord }): Promise<void>;

  getClient(params: { id: string }): Promise<OAuthClientRecord | undefined>;
}
