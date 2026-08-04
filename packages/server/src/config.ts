/**
 * Server configuration.
 *
 * Environment variables are read once at module load into a typed
 * `configuration` object exported as default. Any invalid value throws at
 * import time, so a misconfigured server fails fast at boot instead of
 * mid-run.
 */
import path from 'node:path';

// ============================================================================
// CONFIG FILES
// ============================================================================

/** YAML files the stores load from `REGISTRY_DIR` at startup. */
export const CONFIG_FILES = {
  models: 'models.yaml',
  mcpServers: 'mcp.yaml',
  skills: 'skills.yaml',
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export interface GetEnvOptions {
  defaultValue?: string;
  required?: boolean;
}

export const getEnv = (key: string, options?: GetEnvOptions): string | undefined => {
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
};

/**
 * Normalizes a model/MCP name to the `{NAME}` segment of its env var:
 * uppercase, with every run of non-alphanumeric characters collapsed to `_`.
 * Example: model `gpt-5` -> `GPT_5` -> env var `MODEL_GPT_5_HEADERS`.
 */
export function normalizeEnvName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase();
}

/**
 * Parses a headers env var: must be a JSON object with string values.
 * Malformed values throw so a typo'd credential block fails at startup
 * instead of surfacing as auth errors mid-run. Unset values yield an empty
 * record.
 */
export const parseHeaders = (envKey: string, raw: string | undefined): Record<string, string> => {
  if (raw === undefined) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Environment variable ${envKey} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Environment variable ${envKey} must be a JSON object of string values`);
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new Error(`Environment variable ${envKey} must only contain string values (key "${key}" is not a string)`);
    }
    headers[key] = value;
  }
  return headers;
};

/**
 * Collects `{PREFIX}_{NAME}_HEADERS` env vars into a map keyed by the
 * normalized `{NAME}` — the same normalization lookups use, so any casing of
 * the env var name works. The default `{PREFIX}_HEADERS` var never matches
 * (the regex requires a non-empty `{NAME}` segment).
 */
export const parseHeadersByName = (prefix: 'MODEL' | 'MCP'): Record<string, Record<string, string>> => {
  const pattern = new RegExp(`^${prefix}_(.+)_HEADERS$`);
  const byName: Record<string, Record<string, string>> = {};
  for (const [envKey, raw] of Object.entries(process.env)) {
    const match = envKey.match(pattern);
    if (!match || raw === undefined) continue;
    const name = match[1];
    if (name === undefined) continue;
    byName[normalizeEnvName(name)] = parseHeaders(envKey, raw);
  }
  return byName;
};

/**
 * Collects `MODEL_{NAME}_API_KEY` env vars into a map keyed by the normalized
 * `{NAME}`. The default `MODEL_API_KEY` var never matches (the regex requires
 * a non-empty `{NAME}` segment).
 */
export const parseApiKeysByName = (): Record<string, string> => {
  const pattern = /^MODEL_(.+)_API_KEY$/;
  const byName: Record<string, string> = {};
  for (const [envKey, raw] of Object.entries(process.env)) {
    const match = pattern.exec(envKey);
    if (!match || raw === undefined) continue;
    const name = match[1];
    if (name === undefined) continue;
    byName[normalizeEnvName(name)] = raw;
  }
  return byName;
};

function randomAlphanumeric(length: number): string {
  return Array.from({ length }, () => Math.floor(Math.random() * 36).toString(36)).join('');
}

export const parsePort = (raw: string | undefined): number => {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_PORT;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Environment variable PORT must be an integer between 1 and 65535, got "${raw}"`);
  }
  return port;
};

/** Parses a positive-integer env var, falling back to `defaultValue` when unset/blank. */
export const parsePositiveInt = (options: {
  envKey: string;
  raw: string | undefined;
  defaultValue: number;
}): number => {
  const { envKey, raw, defaultValue } = options;
  if (raw === undefined || raw.trim() === '') {
    return defaultValue;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Environment variable ${envKey} must be a positive integer, got "${raw}"`);
  }
  return value;
};

/** Parses a boolean env var; anything but `true`/`false` throws instead of reading as `false`. */
const parseBoolean = (options: { envKey: string; raw: string | undefined; defaultValue: boolean }): boolean => {
  const { envKey, raw, defaultValue } = options;
  if (raw === undefined || raw.trim() === '') {
    return defaultValue;
  }
  const value = raw.trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Environment variable ${envKey} must be "true" or "false", got "${raw}"`);
};

/** Required env var that also rejects blank strings. */
export const requireNonEmptyEnv = (key: string): string => {
  const value = getEnv(key, { required: true });
  if (value === undefined || value.trim() === '') {
    throw new Error(`Environment variable ${key} is required but was not specified.`);
  }
  return value;
};

/** Builds a Postgres connection URL from discrete `POSTGRES_*` parts. */
export const buildPostgresConnectionString = (parts: {
  user: string;
  password: string;
  host: string;
  port: number;
  database: string;
}): string => {
  return `postgres://${encodeURIComponent(parts.user)}:${encodeURIComponent(parts.password)}@${parts.host}:${String(parts.port)}/${encodeURIComponent(parts.database)}`;
};

// ============================================================================
// CONFIGURATION INTERFACE
// ============================================================================

export const DEFAULT_PORT = 8790;

/** Relative to the working directory, like REGISTRY_DIR; the image sets an absolute FRONTEND_DIR. */
const DEFAULT_FRONTEND_DIR = '../frontend/dist';

/** Turn ids minted by a single-binary process; no peer can ever own them. */
const LOCAL_EXECUTOR_ID = 'local';

/** Dropped in single-binary mode so nothing downstream can connect to a Redis it must not use. */
const resolveRedisUrl = (singleBinary: boolean): string | undefined => {
  if (singleBinary) {
    return undefined;
  }
  return requireNonEmptyEnv('REDIS_URL');
};

/** Always longer than `LOCAL_EXECUTOR_ID`, so a peer can never be mistaken for a local owner. */
const resolveExecutorId = (singleBinary: boolean): string => {
  if (singleBinary) {
    return LOCAL_EXECUTOR_ID;
  }
  return randomAlphanumeric(6);
};

export interface ServerConfiguration {
  /** HTTP port the server listens on. Env: `PORT`. */
  PORT: number;
  /** Peering identity embedded in the turn ids this process mints; `local` in single-binary mode. */
  EXECUTOR_ID: string;
  /**
   * Absolute path to the directory containing the YAML config files
   * (models.yaml, mcp.yaml, skills.yaml). Relative values are resolved
   * against the working directory. Env: `REGISTRY_DIR`, defaults to
   * `./registry`.
   */
  REGISTRY_DIR: string;
  /**
   * Optional override for the model catalog YAML (discovery presets for
   * GET /settings/model-providers/catalog). When unset, the catalog inlined at build
   * time is used. Separate from `REGISTRY_DIR`. Env: `MODEL_CATALOG_PATH`.
   */
  MODEL_CATALOG_PATH: string | undefined;
  /**
   * Optional override for the MCP catalog YAML (discovery presets for
   * GET /settings/mcp-servers/catalog). When unset, the catalog inlined at build
   * time is used. Separate from `REGISTRY_DIR`. Env: `MCP_CATALOG_PATH`.
   */
  MCP_CATALOG_PATH: string | undefined;
  /**
   * Optional override for the skill catalog YAML (discovery presets for
   * GET /settings/skills/catalog). When unset, the catalog inlined at build
   * time is used. Separate from `REGISTRY_DIR`. Env: `SKILL_CATALOG_PATH`.
   */
  SKILL_CATALOG_PATH: string | undefined;
  /**
   * Frontend build served alongside the API; a missing directory leaves the server API-only.
   * Env: `FRONTEND_DIR`, defaults to `../frontend/dist` relative to the working directory.
   */
  FRONTEND_DIR: string;
  /**
   * Default API key for the OpenAI-compatible API at models.yaml's base_url,
   * sent as `Authorization: Bearer <key>` on every model request.
   * Env: `MODEL_API_KEY` (required).
   */
  MODEL_API_KEY: string;
  /**
   * Per-model API key overrides keyed by normalized model name.
   * Env: `MODEL_{NAME}_API_KEY` (see `normalizeEnvName`).
   */
  MODEL_API_KEY_BY_NAME: Record<string, string>;
  /** Extra headers applied to every model request. Env: `MODEL_HEADERS`. */
  MODEL_HEADERS: Record<string, string>;
  /**
   * Per-model header overrides keyed by normalized model name.
   * Env: `MODEL_{NAME}_HEADERS` (see `normalizeEnvName`).
   */
  MODEL_HEADERS_BY_NAME: Record<string, Record<string, string>>;
  /** Default headers applied to every MCP server request. Env: `MCP_HEADERS`. */
  MCP_HEADERS: Record<string, string>;
  /**
   * Per-MCP-server header overrides keyed by normalized server name.
   * Env: `MCP_{NAME}_HEADERS` (see `normalizeEnvName`).
   */
  MCP_HEADERS_BY_NAME: Record<string, Record<string, string>>;
  /**
   * Public base URL of this server used as the origin of the MCP OAuth callback
   * (`{PUBLIC_BASE_URL}/api/v1/mcp-servers/oauth/callback`). Not trimmed.
   * Env: `PUBLIC_BASE_URL` (required).
   */
  PUBLIC_BASE_URL: string;
  /**
   * RFC 7591 client_name shown on authorization-server consent screens.
   * Env: `OAUTH_CLIENT_NAME`. Default: "truefoundry-harness".
   */
  OAUTH_CLIENT_NAME: string;
  /**
   * Sandbox provider settings as a JSON object discriminated on `type`
   * (see SandboxProviderSettingsSchema in the harness; today: "daytona").
   * Unset = sandbox unsupported: specs with `config.sandbox.enabled` are
   * rejected at session creation. Validated at boot by the sandbox factory.
   * Env: `SANDBOX_SETTINGS`.
   */
  SANDBOX_SETTINGS: string | undefined;
  /**
   * Provider API key, kept out of the SANDBOX_SETTINGS JSON blob; overrides
   * an inline `apiKey` when both are set. Env: `SANDBOX_API_KEY`.
   */
  SANDBOX_API_KEY: string | undefined;
  /** Max bytes for a single file download out of the sandbox. Env: `SANDBOX_FILE_MAX_BYTES`. Default 20 MB. */
  SANDBOX_FILE_MAX_BYTES: number;
  /**
   * Lifetime of the signed preview URL minted for the sandbox NATS bridge;
   * effectively the max duration of one turn's sandbox connection.
   * Env: `SANDBOX_PREVIEW_URL_EXPIRY_SECONDS`. Default 1 hour.
   */
  SANDBOX_PREVIEW_URL_EXPIRY_SECONDS: number;
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
  /** Peering URL shared by all replicas; undefined in single-binary mode. Env: `REDIS_URL`. */
  REDIS_URL: string | undefined;
  /**
   * Max ms to wait for a peer executor's reply before failing with 424.
   * Env: `REDIS_REQUEST_REPLY_TIMEOUT_MS`. Default 60000.
   */
  REDIS_REQUEST_REPLY_TIMEOUT_MS: number;
  /**
   * How often this process refreshes its peering heartbeat key.
   * Env: `REDIS_REQUEST_REPLY_HEARTBEAT_INTERVAL_MS`. Default 5000.
   */
  REDIS_REQUEST_REPLY_HEARTBEAT_INTERVAL_MS: number;
  /**
   * TTL for reply values so abandoned reply keys are reclaimed.
   * Env: `REDIS_REQUEST_REPLY_REPLY_TTL_MS`. Default 120000.
   */
  REDIS_REQUEST_REPLY_REPLY_TTL_MS: number;
  /**
   * Sleep between reply poll attempts while waiting on a peer.
   * Env: `REDIS_REQUEST_REPLY_POLL_INTERVAL_MS`. Default 500.
   */
  REDIS_REQUEST_REPLY_POLL_INTERVAL_MS: number;
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
}

// ============================================================================
// CONFIGURATION VALUES
// ============================================================================

const postgresUser = requireNonEmptyEnv('POSTGRES_USER');
const postgresPassword = requireNonEmptyEnv('POSTGRES_PASSWORD');
const postgresDb = requireNonEmptyEnv('POSTGRES_DB');
const postgresHost = requireNonEmptyEnv('POSTGRES_HOST');
const postgresPort = parsePositiveInt({
  envKey: 'POSTGRES_PORT',
  raw: requireNonEmptyEnv('POSTGRES_PORT'),
  defaultValue: 5432,
});
const serverExecutionTimeoutSeconds = parsePositiveInt({
  envKey: 'SERVER_EXECUTION_TIMEOUT_SECONDS',
  raw: getEnv('SERVER_EXECUTION_TIMEOUT_SECONDS'),
  defaultValue: 600,
});

const singleBinary = parseBoolean({
  envKey: 'SINGLE_BINARY',
  raw: getEnv('SINGLE_BINARY'),
  defaultValue: true,
});

const configuration: ServerConfiguration = {
  PORT: parsePort(getEnv('PORT')),
  EXECUTOR_ID: resolveExecutorId(singleBinary),
  REGISTRY_DIR: path.resolve(getEnv('REGISTRY_DIR', { defaultValue: 'registry' }) ?? 'registry'),
  MODEL_CATALOG_PATH: (() => {
    const override = getEnv('MODEL_CATALOG_PATH');
    return override === undefined || override === '' ? undefined : path.resolve(override);
  })(),
  MCP_CATALOG_PATH: (() => {
    const override = getEnv('MCP_CATALOG_PATH');
    return override === undefined || override === '' ? undefined : path.resolve(override);
  })(),
  SKILL_CATALOG_PATH: (() => {
    const override = getEnv('SKILL_CATALOG_PATH');
    return override === undefined || override === '' ? undefined : path.resolve(override);
  })(),
  FRONTEND_DIR: path.resolve(getEnv('FRONTEND_DIR', { defaultValue: DEFAULT_FRONTEND_DIR }) ?? DEFAULT_FRONTEND_DIR),
  MODEL_API_KEY: getEnv('MODEL_API_KEY', { required: true }) ?? '',
  MODEL_API_KEY_BY_NAME: parseApiKeysByName(),
  MODEL_HEADERS: parseHeaders('MODEL_HEADERS', getEnv('MODEL_HEADERS')),
  MODEL_HEADERS_BY_NAME: parseHeadersByName('MODEL'),
  MCP_HEADERS: parseHeaders('MCP_HEADERS', getEnv('MCP_HEADERS')),
  MCP_HEADERS_BY_NAME: parseHeadersByName('MCP'),
  PUBLIC_BASE_URL: getEnv('PUBLIC_BASE_URL', { required: true }) ?? '',
  OAUTH_CLIENT_NAME: getEnv('OAUTH_CLIENT_NAME', { defaultValue: 'truefoundry-harness' }) ?? 'truefoundry-harness',
  SANDBOX_SETTINGS: getEnv('SANDBOX_SETTINGS'),
  SANDBOX_API_KEY: getEnv('SANDBOX_API_KEY'),
  SANDBOX_FILE_MAX_BYTES: parsePositiveInt({
    envKey: 'SANDBOX_FILE_MAX_BYTES',
    raw: getEnv('SANDBOX_FILE_MAX_BYTES'),
    defaultValue: 20_971_520,
  }),
  SANDBOX_PREVIEW_URL_EXPIRY_SECONDS: parsePositiveInt({
    envKey: 'SANDBOX_PREVIEW_URL_EXPIRY_SECONDS',
    raw: getEnv('SANDBOX_PREVIEW_URL_EXPIRY_SECONDS'),
    defaultValue: 3600,
  }),
  GRACEFUL_TIMEOUT_SECONDS: parsePositiveInt({
    envKey: 'GRACEFUL_TIMEOUT_SECONDS',
    raw: getEnv('GRACEFUL_TIMEOUT_SECONDS'),
    defaultValue: 30,
  }),
  SERVER_EXECUTION_TIMEOUT_SECONDS: serverExecutionTimeoutSeconds,
  DATABASE_URL: buildPostgresConnectionString({
    user: postgresUser,
    password: postgresPassword,
    host: postgresHost,
    port: postgresPort,
    database: postgresDb,
  }),
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
  REDIS_URL: resolveRedisUrl(singleBinary),
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
} as const;

export default configuration;
