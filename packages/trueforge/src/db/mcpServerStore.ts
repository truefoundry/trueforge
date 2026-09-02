/**
 * Configured MCP servers: one row per server per tenant, identity as columns plus a
 * Zod-validated `McpServerManifest` jsonb document.
 *
 * - {@link IMcpServerStore}: DB CRUD + DCR client columns (`IOAuthClientStore`).
 *   Implemented by PostgresMcpServerStore / SqliteMcpServerStore.
 * - {@link IMcpServerWithAuthStore}: persistence + authorize / status / revoke;
 *   {@link McpServerWithAuthStore} (separate module) composes an {@link IMcpServerStore} + a token store.
 *
 * OAuth JSONB wire shapes (snake_case) and camelCase ↔ storage mappers live here
 * alongside the store contract — absence is an explicit `| null`, not an optional `?:`.
 */
import type {
  OAuthClientRecord as ContractOAuthClientRecord,
  OAuthPendingAuthorization as ContractOAuthPendingAuthorization,
  OAuthToken as ContractOAuthToken,
  IOAuthClientStore,
} from '../mcp/auth/types';
import type { ResourceName } from '../schemas/common';
import type { McpAuthStatus, McpServerManifest } from '../schemas/mcpServer';

export interface McpServerRecord {
  id: string;
  tenant_id: string;
  name: ResourceName;
  manifest: McpServerManifest;
  /** ISO-8601 UTC instant. */
  created_at: string;
  /** ISO-8601 UTC instant. */
  updated_at: string;
}

export interface GetMcpServerInput {
  tenant_id: string;
  name: string;
}

export interface ListMcpServersInput {
  tenant_id: string;
  /** `undefined` lists all; empty returns `[]` without querying; otherwise `WHERE name IN (...)`. */
  names: readonly string[] | undefined;
}

export interface CreateMcpServerInput {
  tenant_id: string;
  name: ResourceName;
  manifest: McpServerManifest;
}

/** Same shape as create for now; kept as a distinct name for the upsert path. */
export type UpsertMcpServerInput = CreateMcpServerInput;

/** Unique `(tenant_id, name)` violation on create. */
export class McpServerNameConflictError extends Error {
  readonly tenant_id: string;
  readonly server_name: string;

  constructor({ tenant_id, name }: { tenant_id: string; name: string }, options?: ErrorOptions) {
    super(`MCP server name already exists: ${name}`, options);
    this.name = 'McpServerNameConflictError';
    this.tenant_id = tenant_id;
    this.server_name = name;
  }
}

/** Thrown when authorize/revoke/status targets an unknown server name. */
export class McpServerNotFoundError extends Error {
  readonly server_name: string;

  constructor(name: string) {
    super(`MCP server not found: ${name}`);
    this.name = 'McpServerNotFoundError';
    this.server_name = name;
  }
}

export interface ResolveMcpAuthStatusesInput {
  records: readonly McpServerRecord[];
  userRef: string;
}

export interface AuthorizeMcpServerInput {
  tenant_id: string;
  name: string;
  userRef: string;
  /** Relative same-origin path for local DCR pending-auth return. */
  returnTo?: string;
  /** Absolute redirect URL when a remote auth backend needs a full callback URL. */
  redirectURL?: string;
}

export interface DeleteMcpAuthorizationInput {
  tenant_id: string;
  name: string;
  userRef: string;
}

/** Row persistence + DCR client columns — no authorize/status/revoke. */
export interface IMcpServerStore<TTransaction = never> extends IOAuthClientStore<TTransaction> {
  listServers(input: ListMcpServersInput, transaction?: TTransaction): Promise<McpServerRecord[]>;
  getServer(input: GetMcpServerInput, transaction?: TTransaction): Promise<McpServerRecord | undefined>;
  /**
   * Load one server while holding a row lock for the lifetime of `transaction`.
   * Postgres: `SELECT … FOR UPDATE`. SQLite: plain read under a write txn (BEGIN IMMEDIATE).
   * Required before read-modify-write of header secrets so concurrent keep/rotate cannot interleave.
   */
  getServerForUpdate(input: GetMcpServerInput, transaction: TTransaction): Promise<McpServerRecord | undefined>;
  /** Inserts a new server with a generated ULID. Throws McpServerNameConflictError on name clash. */
  createServer(input: CreateMcpServerInput, transaction?: TTransaction): Promise<McpServerRecord>;
  /**
   * Creates the server or replaces `manifest` (+ `updated_at`) only.
   * Never overwrites `id`, `oauth_server`, or `oauth_client`.
   */
  upsertServer(input: UpsertMcpServerInput, transaction?: TTransaction): Promise<McpServerRecord>;
}

/**
 * Settings/MCP API store: persistence plus Connect UX auth.
 * McpServerWithAuthStore implements via a token store; remote-backed stores may call
 * an upstream status/authorize API instead.
 */
export interface IMcpServerWithAuthStore<TTransaction = never> extends IMcpServerStore<TTransaction> {
  /** Wire `auth_status` for Connect UX, keyed by server name. */
  resolveAuthStatuses(input: ResolveMcpAuthStatusesInput): Promise<ReadonlyMap<string, McpAuthStatus>>;

  /** Start or resume authorization; returns `auth_required` + URL or `authenticated`. */
  authorize(input: AuthorizeMcpServerInput): Promise<McpAuthStatus>;

  /** Revoke this subject's authorization for the named server. */
  deleteAuthorization(input: DeleteMcpAuthorizationInput): Promise<void>;
}

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
  return_to: string | null;
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

/** The blob half of a pending authorization; `state`/`id`/`user_id` live in their own columns. */
export function toStoredOAuthPendingAuthorizationData(
  pending: ContractOAuthPendingAuthorization,
): OAuthPendingAuthorizationData {
  return {
    mcp_server_url: pending.mcpServerUrl,
    code_verifier: pending.codeVerifier,
    return_to: pending.returnTo,
  };
}

export function fromStoredOAuthPendingAuthorizationData(
  stored: OAuthPendingAuthorizationData,
): Pick<ContractOAuthPendingAuthorization, 'mcpServerUrl' | 'codeVerifier' | 'returnTo'> {
  return {
    mcpServerUrl: stored.mcp_server_url,
    codeVerifier: stored.code_verifier,
    returnTo: stored.return_to,
  };
}
