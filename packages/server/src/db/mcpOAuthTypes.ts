import type {
  OAuthClientRecord as ContractOAuthClientRecord,
  OAuthPendingAuthorization as ContractOAuthPendingAuthorization,
  OAuthToken as ContractOAuthToken,
} from '@truefoundry/utils-core/core';

// Absence is an explicit `| null`, not an optional `?:`

/**
 * How long a pending authorization stays redeemable — long enough to finish a consent screen,
 * short enough that an abandoned `state` and its PKCE verifier stop being usable. Applied as a
 * `created_at` filter on read by both backends, so no sweep job is needed.
 */
export const PENDING_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;

/** RFC 8414 AS metadata cached at DCR time (`mcp_server.oauth_server`). */
export interface OAuthServer {
  authorization_endpoint: string;
  token_endpoint: string;
  code_challenge_methods_supported: string[] | null;
}

/** RFC 7591 DCR response (`mcp_server.oauth_client`). */
export interface OAuthClient {
  client_id: string;
  client_secret: string | null;
}

/** `oauth_pending_authorization.auth_data` JSONB. */
export interface OAuthPendingAuthorizationData {
  /** MCP server URL from authorize time — needed by the shared callback for RFC 8707 `resource`. */
  mcp_server_url: string;
  code_verifier: string | null;
  redirect_url: string | null;
}

/** `oauth_token.token` JSONB. */
export interface OAuthToken {
  access_token: string;
  refresh_token: string | null;
  /** ISO 8601 */
  expires_at: string;
  scope: string | null;
}

export function toStoredOAuthToken(token: ContractOAuthToken): OAuthToken {
  return {
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
    expires_at: token.expiresAt,
    scope: token.scope,
  };
}

export function fromStoredOAuthToken(stored: OAuthToken): ContractOAuthToken {
  return {
    accessToken: stored.access_token,
    refreshToken: stored.refresh_token,
    expiresAt: stored.expires_at,
    scope: stored.scope,
  };
}

export function toStoredOAuthClientRecord(record: ContractOAuthClientRecord): {
  server: OAuthServer;
  client: OAuthClient;
} {
  return {
    server: {
      authorization_endpoint: record.server.authorizationEndpoint,
      token_endpoint: record.server.tokenEndpoint,
      code_challenge_methods_supported: record.server.codeChallengeMethodsSupported,
    },
    client: {
      client_id: record.client.clientId,
      client_secret: record.client.clientSecret,
    },
  };
}

export function fromStoredOAuthClientRecord(params: {
  server: OAuthServer;
  client: OAuthClient;
}): ContractOAuthClientRecord {
  return {
    server: {
      authorizationEndpoint: params.server.authorization_endpoint,
      tokenEndpoint: params.server.token_endpoint,
      codeChallengeMethodsSupported: params.server.code_challenge_methods_supported,
    },
    client: {
      clientId: params.client.client_id,
      clientSecret: params.client.client_secret,
    },
  };
}

/** The blob half of a pending authorization; `state`/`id` live in their own columns. */
export function toStoredOAuthPendingAuthorizationData(
  pending: ContractOAuthPendingAuthorization,
): OAuthPendingAuthorizationData {
  return {
    mcp_server_url: pending.mcpServerUrl,
    code_verifier: pending.codeVerifier,
    redirect_url: pending.redirectUrl,
  };
}

export function fromStoredOAuthPendingAuthorizationData(
  stored: OAuthPendingAuthorizationData,
): Pick<ContractOAuthPendingAuthorization, 'mcpServerUrl' | 'codeVerifier' | 'redirectUrl'> {
  return {
    mcpServerUrl: stored.mcp_server_url,
    codeVerifier: stored.code_verifier,
    redirectUrl: stored.redirect_url,
  };
}
