/**
 * Configured MCP servers: one row per server per tenant, identity as columns plus a
 * Zod-validated `McpServerManifest` jsonb document.
 *
 * - {@link IMcpServerStore}: DB CRUD + DCR client columns (`IOAuthClientStore`).
 *   Implemented by PostgresMcpServerStore / SqliteMcpServerStore.
 * - {@link IMcpServerWithAuthStore}: persistence + authorize / status / revoke;
 *   {@link McpServerWithAuthStore} composes an {@link IMcpServerStore} + a token store.
 *
 * OAuth JSONB wire shapes (snake_case) and camelCase ↔ storage mappers live here
 * alongside the store contract — absence is an explicit `| null`, not an optional `?:`.
 */
import { isMcpAuthRequired, resolveMcpAuth } from '../mcp/auth/mcpDcr';
import type {
  OAuthClientRecord as ContractOAuthClientRecord,
  OAuthPendingAuthorization as ContractOAuthPendingAuthorization,
  OAuthToken as ContractOAuthToken,
  IOAuthClientStore,
  IOAuthTokenStore,
  OAuthClientRecord,
} from '../mcp/auth/types';
import type { ResourceName } from '../schemas/common';
import { resolveMcpAuthStatus, type McpAuthStatus, type McpServerManifest } from '../schemas/mcpServer';

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
  /** Optional caller credential for remote-backed stores; ignored by local auth. */
  accessToken?: string;
}

export interface AuthorizeMcpServerInput {
  tenant_id: string;
  name: string;
  userRef: string;
  accessToken?: string;
  /** Relative same-origin path for local DCR pending-auth return. */
  returnTo?: string;
  /** Absolute redirect URL when a remote auth backend needs a full callback URL. */
  redirectURL?: string;
}

export interface DeleteMcpAuthorizationInput {
  tenant_id: string;
  name: string;
  userRef: string;
  accessToken?: string;
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
 * Wraps a DB-backed {@link IMcpServerStore} with local DCR authorize / status / revoke
 * so API handlers can call auth methods on the store without depending on a token store.
 */
export class McpServerWithAuthStore<TTransaction = never> implements IMcpServerWithAuthStore<TTransaction> {
  readonly #store: IMcpServerStore<TTransaction>;
  readonly #tokenStore: IOAuthTokenStore<TTransaction>;
  readonly #clientName: string;

  constructor(input: {
    store: IMcpServerStore<TTransaction>;
    tokenStore: IOAuthTokenStore<TTransaction>;
    clientName: string;
  }) {
    this.#store = input.store;
    this.#tokenStore = input.tokenStore;
    this.#clientName = input.clientName;
  }

  listServers(input: ListMcpServersInput, transaction?: TTransaction): Promise<McpServerRecord[]> {
    return this.#store.listServers(input, transaction);
  }

  getServer(input: GetMcpServerInput, transaction?: TTransaction): Promise<McpServerRecord | undefined> {
    return this.#store.getServer(input, transaction);
  }

  getServerForUpdate(input: GetMcpServerInput, transaction: TTransaction): Promise<McpServerRecord | undefined> {
    return this.#store.getServerForUpdate(input, transaction);
  }

  createServer(input: CreateMcpServerInput, transaction?: TTransaction): Promise<McpServerRecord> {
    return this.#store.createServer(input, transaction);
  }

  upsertServer(input: UpsertMcpServerInput, transaction?: TTransaction): Promise<McpServerRecord> {
    return this.#store.upsertServer(input, transaction);
  }

  saveClient(params: { id: string; record: OAuthClientRecord }, transaction?: TTransaction): Promise<void> {
    return this.#store.saveClient(params, transaction);
  }

  getClient(params: { id: string }, transaction?: TTransaction): Promise<OAuthClientRecord | undefined> {
    return this.#store.getClient(params, transaction);
  }

  deleteClient(params: { id: string }, transaction?: TTransaction): Promise<void> {
    return this.#store.deleteClient(params, transaction);
  }

  async resolveAuthStatuses(input: ResolveMcpAuthStatusesInput): Promise<ReadonlyMap<string, McpAuthStatus>> {
    void input.accessToken;
    const dcrIds = input.records.filter(record => record.manifest.auth?.type === 'dcr').map(record => record.id);
    const tokens = await this.#tokenStore.getTokens({ ids: dcrIds, userRef: input.userRef });
    const out = new Map<string, McpAuthStatus>();
    for (const record of input.records) {
      const token = tokens.get(record.id);
      out.set(
        record.name,
        resolveMcpAuthStatus({
          manifest: record.manifest,
          ...(token !== undefined ? { token } : {}),
        }),
      );
    }
    return out;
  }

  async authorize(input: AuthorizeMcpServerInput): Promise<McpAuthStatus> {
    void input.accessToken;
    void input.redirectURL;
    const record = await this.#store.getServer({ tenant_id: input.tenant_id, name: input.name });
    if (record === undefined) {
      throw new McpServerNotFoundError(input.name);
    }
    if (record.manifest.auth?.type !== 'dcr') {
      return resolveMcpAuthStatus({ manifest: record.manifest });
    }
    const result = await resolveMcpAuth({
      tokenStore: this.#tokenStore,
      mcpServerStore: this.#store,
      serverId: record.id,
      userRef: input.userRef,
      mcpServerUrl: record.manifest.url,
      mcpServerName: record.name,
      clientName: this.#clientName,
      ...(input.returnTo !== undefined ? { returnTo: input.returnTo } : {}),
    });
    return isMcpAuthRequired(result)
      ? { status: 'auth_required', authorization_url: result.authUrl.href }
      : { status: 'authenticated' };
  }

  async deleteAuthorization(input: DeleteMcpAuthorizationInput): Promise<void> {
    void input.accessToken;
    const record = await this.#store.getServer({ tenant_id: input.tenant_id, name: input.name });
    if (record === undefined) {
      throw new McpServerNotFoundError(input.name);
    }
    if (record.manifest.auth?.type === 'dcr') {
      await this.#tokenStore.deleteToken({ id: record.id, userRef: input.userRef });
    }
  }
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
