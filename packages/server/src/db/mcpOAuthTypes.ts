/**
 * Canonical JSON shapes for MCP OAuth columns (`mcp_server`, `oauth_token`,
 * `oauth_pending_authorization`). Owned by the server DB layer — not the harness.
 *
 * Contract types from `@truefoundry/utils/core` happen to match field for field today, so the
 * converters at the bottom are the seam that lets either side change without the other noticing.
 */
import type {
  OAuthClientRecord as ContractOAuthClientRecord,
  OAuthToken as ContractOAuthToken,
} from '@truefoundry/utils/core';

// Absence is an explicit `| null`, not an optional `?:`

/**
 * How long a pending authorization stays redeemable — long enough to finish a consent screen,
 * short enough that an abandoned `state` and its PKCE verifier stop being usable. Applied as a
 * `created_at` filter on read by both backends, so no sweep job is needed.
 */
export const PENDING_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;

/** RFC 8414 AS metadata cached at DCR time (`mcp_server.oauth_server`). */
export interface OAuthServer {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  codeChallengeMethodsSupported: string[] | null;
}

/** RFC 7591 DCR response (`mcp_server.oauth_client`). */
export interface OAuthClient {
  clientId: string;
  clientSecret: string | null;
}

/** `oauth_pending_authorization.auth_data` JSONB. */
export interface OAuthPendingAuthorizationData {
  /** MCP server URL from authorize time — needed by the shared callback for RFC 8707 `resource`. */
  mcpServerUrl: string;
  codeVerifier: string | null;
  redirectUrl: string | null;
}

/** `oauth_token.token` JSONB. */
export interface OAuthToken {
  accessToken: string;
  refreshToken: string | null;
  /** ISO 8601 */
  expiresAt: string;
  scope: string | null;
}

export function toStoredOAuthToken(token: ContractOAuthToken): OAuthToken {
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt,
    scope: token.scope,
  };
}

export function fromStoredOAuthToken(stored: OAuthToken): ContractOAuthToken {
  return {
    accessToken: stored.accessToken,
    refreshToken: stored.refreshToken,
    expiresAt: stored.expiresAt,
    scope: stored.scope,
  };
}

export function toStoredOAuthClientRecord(record: ContractOAuthClientRecord): {
  server: OAuthServer;
  client: OAuthClient;
} {
  return {
    server: {
      authorizationEndpoint: record.server.authorizationEndpoint,
      tokenEndpoint: record.server.tokenEndpoint,
      codeChallengeMethodsSupported: record.server.codeChallengeMethodsSupported,
    },
    client: {
      clientId: record.client.clientId,
      clientSecret: record.client.clientSecret,
    },
  };
}

export function fromStoredOAuthClientRecord(params: {
  server: OAuthServer;
  client: OAuthClient;
}): ContractOAuthClientRecord {
  return {
    server: {
      authorizationEndpoint: params.server.authorizationEndpoint,
      tokenEndpoint: params.server.tokenEndpoint,
      codeChallengeMethodsSupported: params.server.codeChallengeMethodsSupported,
    },
    client: {
      clientId: params.client.clientId,
      clientSecret: params.client.clientSecret,
    },
  };
}
