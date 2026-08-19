/**
 * Server configuration.
 *
 * Environment variables are read once at module load into a typed
 * `configuration` object exported as default. Any invalid value throws at
 * import time, so a misconfigured server fails fast at boot instead of
 * mid-run.
 *
 * `STANDALONE` is a discriminated mode selector:
 * - `true` (default): SQLite only; no Redis / executor peering.
 * - `false`: Postgres + Redis (defaults to local trueforge credentials /
 *   `redis://localhost:6379`).
 */
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import envPaths from 'env-paths';

const DEFAULT_PORT = 8790;
/** Loopback default; container images set HOST=0.0.0.0 so probes and Service traffic reach the process. */
const DEFAULT_HOST = 'localhost';
/** Default HTTP request body ceiling: 30 MB. */
const DEFAULT_MAX_REQUEST_BODY_BYTES = 30 * 1024 * 1024;
/**
 * Package root whether this module runs as `src/config.ts` (tsx) or is bundled
 * into `dist/main.js` / `dist/cli.js` (`import.meta` → `dist/` → parent).
 */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Turn ids minted by a standalone process; no peer can ever own them. */
const LOCAL_EXECUTOR_ID = 'local';
/** OS-standard data dir for SQLite in standalone mode. */
const ENV_PATHS_APP_NAME = 'trueforge';
const DEFAULT_POSTGRES_USER = 'trueforge';
const DEFAULT_POSTGRES_PASSWORD = 'trueforge';
const DEFAULT_POSTGRES_DB = 'trueforge';
const DEFAULT_POSTGRES_HOST = 'localhost';
const DEFAULT_POSTGRES_PORT = 5432;
const DEFAULT_REDIS_URL = 'redis://localhost:6379';

const DEFAULT_OIDC_USER_REFERENCE_CLAIM = 'sub';
const DEFAULT_OIDC_USER_ROLE_CLAIM = 'groups';
const DEFAULT_OIDC_ADMIN_ROLE_VALUE = 'admin';
const DEFAULT_OIDC_SCOPES = 'openid,profile,email';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export interface GetEnvOptions {
  defaultValue?: string;
  required?: boolean;
}

function getEnv(key: string, options?: GetEnvOptions): string | undefined {
  const value = process.env[key];
  if (value !== undefined) {
    return value;
  }

  // Checking for undefined as value can also be 0 or ""
  if (options?.defaultValue !== undefined) {
    return options.defaultValue;
  }

  if (options?.required) {
    throw new Error(`Environment variable ${key} is required but was not specified.`);
  }

  return undefined;
}

function randomAlphanumeric(length: number): string {
  return Array.from({ length }, () => Math.floor(Math.random() * 36).toString(36)).join('');
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_PORT;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Environment variable PORT must be an integer between 1 and 65535, got "${raw}"`);
  }
  return port;
}

export function parseOidcScopes(raw: string): string[] {
  const scopes = raw
    .split(',')
    .map(part => part.trim())
    .filter(part => part.length > 0);
  if (scopes.length === 0) {
    throw new Error('OIDC_SCOPES must contain at least one scope.');
  }
  return scopes;
}

/** Parses a positive-integer env var, falling back to `defaultValue` when unset/blank. */
function parsePositiveInt(options: { envKey: string; raw: string | undefined; defaultValue: number }): number {
  const { envKey, raw, defaultValue } = options;
  if (raw === undefined || raw.trim() === '') {
    return defaultValue;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Environment variable ${envKey} must be a positive integer, got "${raw}"`);
  }
  return value;
}

/** Parses a boolean env var; anything but `true`/`false` throws instead of reading as `false`. */
function parseBoolean(options: { envKey: string; raw: string | undefined; defaultValue: boolean }): boolean {
  const { envKey, raw, defaultValue } = options;
  if (raw === undefined || raw.trim() === '') {
    return defaultValue;
  }
  const value = raw.trim().toLowerCase();
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error(`Environment variable ${envKey} must be "true" or "false", got "${raw}"`);
}

/**
 * Prefer `dist/_frontend` shipped in the npm tarball (npx / `pnpm start`).
 * Fall back to the monorepo sibling `../frontend/dist` (host-dev before a copy).
 */
function resolveDefaultFrontendDir(): string {
  const packaged = path.join(PACKAGE_ROOT, 'dist', '_frontend');
  if (existsSync(path.join(packaged, 'index.html'))) {
    return packaged;
  }
  return path.join(PACKAGE_ROOT, '..', 'frontend', 'dist');
}

function resolveFrontendDir(): string {
  const override = getEnv('FRONTEND_DIR');
  if (override !== undefined && override.trim() !== '') {
    return path.resolve(override);
  }
  return resolveDefaultFrontendDir();
}

/** Absolute path from an optional env override; unset/blank → `undefined`. */
function resolveOptionalPathEnv(envKey: string): string | undefined {
  const override = getEnv(envKey);
  if (override === undefined || override.trim() === '') {
    return undefined;
  }
  return path.resolve(override);
}

/**
 * Absolute SQLite file path for standalone mode.
 * Env: `SQLITE_PATH` (optional). Default: `{env-paths data}/db/db.sqlite`.
 */
function resolveSqlitePath(): string {
  const override = getEnv('SQLITE_PATH');
  if (override !== undefined && override.trim() !== '') {
    return path.resolve(override);
  }
  const paths = envPaths(ENV_PATHS_APP_NAME, { suffix: '' });
  return path.join(paths.data, 'db', 'db.sqlite');
}

/** Parent for local sandbox roots. Same env-paths data dir as SQLite (`{suffix:''}`). */
function resolveLocalSandboxRootParent(): string {
  return path.join(envPaths(ENV_PATHS_APP_NAME, { suffix: '' }).data, 'sandboxes');
}

/** Short tmp parent for Code Mode UDS socks (≤65 bytes after realpath). */
function resolveCodeModeSocketParent(): string {
  return path.join(os.tmpdir(), 'tf_cms');
}

/** Redis peering URL for distributed mode. Env: `REDIS_URL`. */
function resolveRedisUrl(): string {
  const raw = getEnv('REDIS_URL', { defaultValue: DEFAULT_REDIS_URL }) ?? DEFAULT_REDIS_URL;
  if (raw.trim() === '') {
    throw new Error('Environment variable REDIS_URL must be non-empty when STANDALONE=false.');
  }
  return raw;
}

/** Postgres connection string derived from `POSTGRES_*` for distributed mode. */
function resolvePostgresDatabaseUrl(): string {
  const postgresUser = getEnv('POSTGRES_USER', { defaultValue: DEFAULT_POSTGRES_USER }) ?? DEFAULT_POSTGRES_USER;
  const postgresPassword =
    getEnv('POSTGRES_PASSWORD', { defaultValue: DEFAULT_POSTGRES_PASSWORD }) ?? DEFAULT_POSTGRES_PASSWORD;
  const postgresDb = getEnv('POSTGRES_DB', { defaultValue: DEFAULT_POSTGRES_DB }) ?? DEFAULT_POSTGRES_DB;
  const postgresHost = getEnv('POSTGRES_HOST', { defaultValue: DEFAULT_POSTGRES_HOST }) ?? DEFAULT_POSTGRES_HOST;
  const postgresPort = parsePositiveInt({
    envKey: 'POSTGRES_PORT',
    raw: getEnv('POSTGRES_PORT'),
    defaultValue: DEFAULT_POSTGRES_PORT,
  });
  if (
    postgresUser.trim() === '' ||
    postgresPassword.trim() === '' ||
    postgresDb.trim() === '' ||
    postgresHost.trim() === ''
  ) {
    throw new Error(
      'POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, and POSTGRES_HOST must be non-empty when STANDALONE=false.',
    );
  }
  return buildPostgresConnectionString({
    user: postgresUser,
    password: postgresPassword,
    host: postgresHost,
    port: postgresPort,
    database: postgresDb,
  });
}

/** Builds a Postgres connection URL from discrete `POSTGRES_*` parts. */
function buildPostgresConnectionString(parts: {
  user: string;
  password: string;
  host: string;
  port: number;
  database: string;
}): string {
  return `postgres://${encodeURIComponent(parts.user)}:${encodeURIComponent(parts.password)}@${parts.host}:${String(parts.port)}/${encodeURIComponent(parts.database)}`;
}

function resolveOIDCConfig(): OIDCConfig | undefined {
  const issuerUrl = getEnv('OIDC_ISSUER_URL');
  const clientId = getEnv('OIDC_CLIENT_ID');
  const clientSecret = getEnv('OIDC_CLIENT_SECRET');

  if (!issuerUrl && !clientId && !clientSecret) {
    return undefined;
  }
  if (!issuerUrl || !clientId || !clientSecret) {
    throw new Error(
      'OIDC_ISSUER_URL, OIDC_CLIENT_ID, and OIDC_CLIENT_SECRET must all be set together, or all left unset ' +
        '(unset = fixed local admin identity, no IdP).',
    );
  }
  return {
    OIDC_ISSUER_URL: issuerUrl,
    OIDC_CLIENT_ID: clientId,
    OIDC_CLIENT_SECRET: clientSecret,
    OIDC_USER_REFERENCE_CLAIM:
      getEnv('OIDC_USER_REFERENCE_CLAIM', { defaultValue: DEFAULT_OIDC_USER_REFERENCE_CLAIM }) ??
      DEFAULT_OIDC_USER_REFERENCE_CLAIM,
    OIDC_USER_ROLE_CLAIM:
      getEnv('OIDC_USER_ROLE_CLAIM', { defaultValue: DEFAULT_OIDC_USER_ROLE_CLAIM }) ?? DEFAULT_OIDC_USER_ROLE_CLAIM,
    OIDC_ADMIN_ROLE_VALUE:
      getEnv('OIDC_ADMIN_ROLE_VALUE', { defaultValue: DEFAULT_OIDC_ADMIN_ROLE_VALUE }) ?? DEFAULT_OIDC_ADMIN_ROLE_VALUE,
    OIDC_SCOPES: parseOidcScopes(getEnv('OIDC_SCOPES', { defaultValue: DEFAULT_OIDC_SCOPES }) ?? DEFAULT_OIDC_SCOPES),
  };
}

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

export interface OIDCConfig {
  /** e.g. an Okta custom authorization server, or an Azure AD tenant's v2.0 endpoint. Env: `OIDC_ISSUER_URL`. */
  OIDC_ISSUER_URL: string;
  /** Client ID for the OIDC client;*/
  OIDC_CLIENT_ID: string;
  /** Client secret for the OIDC client*/
  OIDC_CLIENT_SECRET: string;
  /** Claim to be used as the user reference; e.g. "sub" or "email"
   * Optional; defaults to "sub"
   */
  OIDC_USER_REFERENCE_CLAIM: string;
  /** Claim to be used as the user role; e.g. "role" or "groups"
   * Optional; defaults to "groups"
   */
  OIDC_USER_ROLE_CLAIM: string;
  /** Value of the user role claim that will be used to grant admin access to the server
   * Case sensitive. Optional; defaults to "admin"
   */
  OIDC_ADMIN_ROLE_VALUE: string;
  /** Comma-separated OAuth scopes for the authorization request. Env: `OIDC_SCOPES`.
   * Optional; defaults to "openid,profile,email". Whitespace around entries is stripped.
   * Okta `groups` claims require the `groups` scope; Azure AD app roles typically omit it.
   */
  OIDC_SCOPES: string[];
}

export interface SharedServerConfiguration {
  /** Log level. Env: `LOG_LEVEL`. */
  LOG_LEVEL: string;
  /** Node environment. Env: `NODE_ENV`. */
  NODE_ENV: string | undefined;
  /** HTTP port the server listens on. Env: `PORT`. */
  PORT: number;
  /** HTTP bind address. Env: `HOST`. Default `localhost`; production images use `0.0.0.0`. */
  HOST: string;
  /** Peering identity embedded in the turn ids this process mints; `local` in standalone mode. */
  EXECUTOR_ID: string;
  /**
   * Optional override for the model catalog YAML (discovery presets for
   * GET /catalogs/model-providers). When unset, the catalog inlined at build
   * time is used. Env: `MODEL_CATALOG_PATH`.
   */
  MODEL_CATALOG_PATH: string | undefined;
  /**
   * Optional override for the MCP catalog YAML (discovery presets for
   * GET /catalogs/mcp-servers). When unset, the catalog inlined at build
   * time is used. Env: `MCP_CATALOG_PATH`.
   */
  MCP_CATALOG_PATH: string | undefined;
  /**
   * Optional override for the skill catalog YAML (discovery presets for
   * GET /catalogs/skills). When unset, the catalog inlined at build
   * time is used. Env: `SKILL_CATALOG_PATH`.
   */
  SKILL_CATALOG_PATH: string | undefined;
  /**
   * Optional override for the sandbox catalog YAML (discovery presets for
   * GET /catalogs/sandbox-providers). When unset, the catalog inlined at build
   * time is used. Env: `SANDBOX_CATALOG_PATH`.
   */
  SANDBOX_CATALOG_PATH: string | undefined;
  /**
   * Frontend build served alongside the API; a missing directory leaves the server API-only.
   * Env: `FRONTEND_DIR`. Default: packaged `dist/_frontend` (npx tarball) or
   * monorepo `packages/frontend/dist` — always absolute, independent of CWD.
   */
  FRONTEND_DIR: string;
  /** Max milliseconds for one MCP request. Env: `MCP_REQUEST_TIMEOUT_MS`. Default 4 minutes. */
  MCP_REQUEST_TIMEOUT_MS: number;
  /** Max milliseconds for an MCP transport connection. Env: `MCP_CONNECT_TIMEOUT_MS`. Default 30 seconds. */
  MCP_CONNECT_TIMEOUT_MS: number;
  /**
   * Client name used for Dynamic Client Registration (DCR) of MCP servers.
   * This is the client name shown on authorization-server consent screens.
   * Env: `MCP_DCR_OAUTH_CLIENT_NAME`. Default: "truefoundry-harness".
   */
  MCP_DCR_OAUTH_CLIENT_NAME: string;
  /**
   * Max bytes for a single file download out of the sandbox.
   * Env: `SANDBOX_FILE_MAX_BYTES_FOR_DOWNLOAD`. Default 20 MB (same as gateway).
   */
  SANDBOX_FILE_MAX_BYTES_FOR_DOWNLOAD: number;
  /**
   * Max bytes for an HTTP request body. Env: `MAX_REQUEST_BODY_BYTES`. Default 30 MB.
   */
  MAX_REQUEST_BODY_BYTES: number;
  /**
   * Max seconds to wait for turn cancellation + connection drain on SIGTERM/SIGINT.
   * Env: `GRACEFUL_TIMEOUT_SECONDS`. Default 30.
   */
  GRACEFUL_TIMEOUT_SECONDS: number;
  /**
   * Max seconds a single turn may execute before it is cancelled with
   * `server-execution-timeout`. Env: `SERVER_EXECUTION_TIMEOUT_SECONDS`. Default 600 (10 minutes).
   */
  SERVER_EXECUTION_TIMEOUT_SECONDS: number;
  /**
   * TTL for a running turn's resumable event stream.
   * Env: `TURN_STREAM_TTL_SECONDS`. Default execution timeout + 300.
   */
  TURN_STREAM_TTL_SECONDS: number;
  /**
   * TTL retained after `turn.done` so subscribers can drain remaining events.
   * Env: `TURN_STREAM_POST_COMPLETION_TTL_SECONDS`. Default 300.
   */
  TURN_STREAM_POST_COMPLETION_TTL_SECONDS: number;
  /**
   * Max ms to keep a turn subscription open.
   * Env: `TURN_SUBSCRIBE_TIMEOUT_MS`. Default 600000.
   */
  TURN_SUBSCRIBE_TIMEOUT_MS: number;
  /**
   * Max ms to wait for a peer executor's reply before failing with 424.
   * Env: `REDIS_REQUEST_REPLY_TIMEOUT_MS`. Default 60000.
   * Only used when a Redis client is wired (distributed mode).
   */
  REDIS_REQUEST_REPLY_TIMEOUT_MS: number;
  /**
   * How often this process refreshes its peering heartbeat key.
   * Env: `REDIS_REQUEST_REPLY_HEARTBEAT_INTERVAL_MS`. Default 5000.
   * Only used when a Redis client is wired (distributed mode).
   */
  REDIS_REQUEST_REPLY_HEARTBEAT_INTERVAL_MS: number;
  /**
   * TTL for reply values so abandoned reply keys are reclaimed.
   * Env: `REDIS_REQUEST_REPLY_REPLY_TTL_MS`. Default 120000.
   * Only used when a Redis client is wired (distributed mode).
   */
  REDIS_REQUEST_REPLY_REPLY_TTL_MS: number;
  /**
   * Sleep between reply poll attempts while waiting on a peer.
   * Env: `REDIS_REQUEST_REPLY_POLL_INTERVAL_MS`. Default 500.
   * Only used when a Redis client is wired (distributed mode).
   */
  REDIS_REQUEST_REPLY_POLL_INTERVAL_MS: number;
}

export type StandaloneServerConfiguration = SharedServerConfiguration & {
  /**
   * Single-process topology: SQLite persistence, no Redis / executor peering.
   * Env: `STANDALONE`. Default: true.
   */
  STANDALONE: true;
  /**
   * Absolute SQLite database file path.
   * Env: `SQLITE_PATH` (optional). Default: env-paths data dir + `db/db.sqlite`.
   */
  SQLITE_PATH: string;
  /**
   * Parent directory for local sandbox roots (ULID children).
   * Derived: `{env-paths data}/sandboxes`.
   */
  LOCAL_SANDBOX_ROOT_PARENT: string;
  /**
   * Parent directory for Code Mode UDS sockets (`tf_cms` under os.tmpdir()).
   * Caller prepares/removes this directory; must stay ≤65 bytes after realpath.
   */
  CODE_MODE_SOCKET_PARENT: string;
};

export type DistributedServerConfiguration = SharedServerConfiguration & {
  /**
   * Multi-replica topology: Postgres persistence + Redis executor peering.
   * Env: `STANDALONE`. Default: true (so this branch requires an explicit `false`).
   */
  STANDALONE: false;
  /**
   * Public base URL of this server used as the origin of MCP OAuth and OIDC
   * callbacks. Optional at boot; MCP OAuth and OIDC callback construction fail
   * if empty.
   */
  PUBLIC_BASE_URL: string;
  /**
   * Postgres connection string derived from `POSTGRES_*` (not read from env directly).
   * Form: `postgres://USER:PASSWORD@HOST:PORT/DB` with user/password URL-encoded.
   */
  DATABASE_URL: string;
  /** Max connections in the `pg` Pool. Env: `DATABASE_POOL_MAX`. Default 10. */
  DATABASE_POOL_MAX: number;
  /**
   * Postgres `statement_timeout` for app and migrations (same pool).
   * Env: `POSTGRES_STATEMENT_TIMEOUT_MS`. Default 60000.
   */
  POSTGRES_STATEMENT_TIMEOUT_MS: number;
  /**
   * Postgres `idle_in_transaction_session_timeout` for app and migrations (same pool).
   * Env: `POSTGRES_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS`. Default 60000.
   */
  POSTGRES_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS: number;
  /** Peering URL shared by all replicas. Env: `REDIS_URL`. Default `redis://localhost:6379`. */
  REDIS_URL: string;
  /**
   * OIDC configuration for server authentication.
   * Undefined means browser login is disabled.
   */
  OIDC: OIDCConfig | undefined;
};

export type ServerConfiguration = StandaloneServerConfiguration | DistributedServerConfiguration;

// ============================================================================
// CONFIGURATION VALUES
// ============================================================================

const serverExecutionTimeoutSeconds = parsePositiveInt({
  envKey: 'SERVER_EXECUTION_TIMEOUT_SECONDS',
  raw: getEnv('SERVER_EXECUTION_TIMEOUT_SECONDS'),
  defaultValue: 600,
});

const standalone = parseBoolean({
  envKey: 'STANDALONE',
  raw: getEnv('STANDALONE'),
  defaultValue: true,
});

const port = parsePort(getEnv('PORT'));
const host = getEnv('HOST', { defaultValue: DEFAULT_HOST }) ?? DEFAULT_HOST;

const shared: SharedServerConfiguration = {
  LOG_LEVEL: getEnv('LOG_LEVEL', { defaultValue: 'info' }) ?? 'info',
  NODE_ENV: getEnv('NODE_ENV'),
  PORT: port,
  HOST: host,
  EXECUTOR_ID: standalone ? LOCAL_EXECUTOR_ID : randomAlphanumeric(6),
  MODEL_CATALOG_PATH: resolveOptionalPathEnv('MODEL_CATALOG_PATH'),
  MCP_CATALOG_PATH: resolveOptionalPathEnv('MCP_CATALOG_PATH'),
  SKILL_CATALOG_PATH: resolveOptionalPathEnv('SKILL_CATALOG_PATH'),
  SANDBOX_CATALOG_PATH: resolveOptionalPathEnv('SANDBOX_CATALOG_PATH'),
  FRONTEND_DIR: resolveFrontendDir(),

  MCP_REQUEST_TIMEOUT_MS: parsePositiveInt({
    envKey: 'MCP_REQUEST_TIMEOUT_MS',
    raw: getEnv('MCP_REQUEST_TIMEOUT_MS'),
    defaultValue: 4 * 60 * 1000,
  }),
  MCP_CONNECT_TIMEOUT_MS: parsePositiveInt({
    envKey: 'MCP_CONNECT_TIMEOUT_MS',
    raw: getEnv('MCP_CONNECT_TIMEOUT_MS'),
    defaultValue: 30 * 1000,
  }),
  MCP_DCR_OAUTH_CLIENT_NAME:
    getEnv('MCP_DCR_OAUTH_CLIENT_NAME', { defaultValue: 'truefoundry-harness' }) ?? 'truefoundry-harness',
  SANDBOX_FILE_MAX_BYTES_FOR_DOWNLOAD: parsePositiveInt({
    envKey: 'SANDBOX_FILE_MAX_BYTES_FOR_DOWNLOAD',
    raw: getEnv('SANDBOX_FILE_MAX_BYTES_FOR_DOWNLOAD'),
    defaultValue: 20_971_520,
  }),
  MAX_REQUEST_BODY_BYTES: parsePositiveInt({
    envKey: 'MAX_REQUEST_BODY_BYTES',
    raw: getEnv('MAX_REQUEST_BODY_BYTES'),
    defaultValue: DEFAULT_MAX_REQUEST_BODY_BYTES,
  }),
  GRACEFUL_TIMEOUT_SECONDS: parsePositiveInt({
    envKey: 'GRACEFUL_TIMEOUT_SECONDS',
    raw: getEnv('GRACEFUL_TIMEOUT_SECONDS'),
    defaultValue: 30,
  }),
  SERVER_EXECUTION_TIMEOUT_SECONDS: serverExecutionTimeoutSeconds,
  TURN_STREAM_TTL_SECONDS: parsePositiveInt({
    envKey: 'TURN_STREAM_TTL_SECONDS',
    raw: getEnv('TURN_STREAM_TTL_SECONDS'),
    defaultValue: serverExecutionTimeoutSeconds + 300,
  }),
  TURN_STREAM_POST_COMPLETION_TTL_SECONDS: parsePositiveInt({
    envKey: 'TURN_STREAM_POST_COMPLETION_TTL_SECONDS',
    raw: getEnv('TURN_STREAM_POST_COMPLETION_TTL_SECONDS'),
    defaultValue: 300,
  }),
  TURN_SUBSCRIBE_TIMEOUT_MS: parsePositiveInt({
    envKey: 'TURN_SUBSCRIBE_TIMEOUT_MS',
    raw: getEnv('TURN_SUBSCRIBE_TIMEOUT_MS'),
    defaultValue: 600_000,
  }),
  REDIS_REQUEST_REPLY_TIMEOUT_MS: parsePositiveInt({
    envKey: 'REDIS_REQUEST_REPLY_TIMEOUT_MS',
    raw: getEnv('REDIS_REQUEST_REPLY_TIMEOUT_MS'),
    defaultValue: 60_000,
  }),
  REDIS_REQUEST_REPLY_HEARTBEAT_INTERVAL_MS: parsePositiveInt({
    envKey: 'REDIS_REQUEST_REPLY_HEARTBEAT_INTERVAL_MS',
    raw: getEnv('REDIS_REQUEST_REPLY_HEARTBEAT_INTERVAL_MS'),
    defaultValue: 5_000,
  }),
  REDIS_REQUEST_REPLY_REPLY_TTL_MS: parsePositiveInt({
    envKey: 'REDIS_REQUEST_REPLY_REPLY_TTL_MS',
    raw: getEnv('REDIS_REQUEST_REPLY_REPLY_TTL_MS'),
    defaultValue: 120_000,
  }),
  REDIS_REQUEST_REPLY_POLL_INTERVAL_MS: parsePositiveInt({
    envKey: 'REDIS_REQUEST_REPLY_POLL_INTERVAL_MS',
    raw: getEnv('REDIS_REQUEST_REPLY_POLL_INTERVAL_MS'),
    defaultValue: 500,
  }),
};

const configuration: ServerConfiguration = standalone
  ? {
      ...shared,
      STANDALONE: true,
      SQLITE_PATH: resolveSqlitePath(),
      LOCAL_SANDBOX_ROOT_PARENT: resolveLocalSandboxRootParent(),
      CODE_MODE_SOCKET_PARENT: resolveCodeModeSocketParent(),
    }
  : {
      ...shared,
      STANDALONE: false,
      PUBLIC_BASE_URL: getEnv('PUBLIC_BASE_URL', { defaultValue: '' }) ?? '',
      DATABASE_URL: resolvePostgresDatabaseUrl(),
      DATABASE_POOL_MAX: parsePositiveInt({
        envKey: 'DATABASE_POOL_MAX',
        raw: getEnv('DATABASE_POOL_MAX'),
        defaultValue: 10,
      }),
      POSTGRES_STATEMENT_TIMEOUT_MS: parsePositiveInt({
        envKey: 'POSTGRES_STATEMENT_TIMEOUT_MS',
        raw: getEnv('POSTGRES_STATEMENT_TIMEOUT_MS'),
        defaultValue: 60_000,
      }),
      POSTGRES_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS: parsePositiveInt({
        envKey: 'POSTGRES_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS',
        raw: getEnv('POSTGRES_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS'),
        defaultValue: 60_000,
      }),
      REDIS_URL: resolveRedisUrl(),
      OIDC: resolveOIDCConfig(),
    };

export function isOidcConfigured(
  value: ServerConfiguration,
): value is DistributedServerConfiguration & { OIDC: OIDCConfig } {
  return !value.STANDALONE && value.OIDC !== undefined;
}

/**
 * Public origin for OAuth callbacks.
 * Standalone → `http://localhost:$PORT`; distributed → `PUBLIC_BASE_URL` (may be `''`).
 */
export function getPublicBaseUrl(config: ServerConfiguration = configuration): string {
  if (config.STANDALONE) {
    return `http://localhost:${String(config.PORT)}`;
  }
  if (config.PUBLIC_BASE_URL === '') {
    throw new Error('PUBLIC_BASE_URL is required for OIDC callbacks but was empty');
  }
  return config.PUBLIC_BASE_URL;
}

export default configuration;
