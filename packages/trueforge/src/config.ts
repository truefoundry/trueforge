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
 * - `false`: Postgres; Redis required for the server (optional for controller / migrate).
 */
import { existsSync, readFileSync } from 'node:fs';
import { isIPv6 } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import envPaths from 'env-paths';
import { z } from 'zod';

import { parseRedisSentinelNodes, type RedisConnection } from './runtime/redis';

export type { RedisConnection };

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
/** Default Postgres schema for app tables + Kysely migration bookkeeping. */
export const DEFAULT_POSTGRES_SCHEMA = 'trueforge';
/** Unquoted Postgres identifier: letter/underscore start, then alnum/underscore, ≤63 chars. */
const POSTGRES_SCHEMA_NAME_RE = /^[a-z_][a-z0-9_]{0,62}$/;
/**
 * Fixed local service credential when `STANDALONE=true` and `TRUEFORGE_API_KEY` is unset.
 * Local testing only — not for distributed deployments.
 */
export const STANDALONE_TRUEFORGE_API_KEY = 'trueforge-standalone';

const DEFAULT_OIDC_USER_REFERENCE_CLAIM = 'sub';
const DEFAULT_OIDC_USER_DISPLAY_NAME_CLAIM = 'name';
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

const POSTGRES_SSL_MODES = ['disable', 'prefer', 'require', 'verify-ca', 'verify-full', 'no-verify'] as const;
type PostgresSslMode = (typeof POSTGRES_SSL_MODES)[number];

/** pg Pool `ssl` object fields (client certs / CA / no-verify). */
export interface PostgresSslConfig {
  cert?: string;
  key?: string;
  ca?: string;
  rejectUnauthorized?: boolean;
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

/**
 * Parses a comma-separated env list (trim, drop empties). Empty / unset → `[]`.
 */
export function parseCommaSeparatedEnvList(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') {
    return [];
  }
  return raw
    .split(',')
    .map(part => part.trim())
    .filter(part => part.length > 0);
}

/** Parses a JSON string array env. Empty / unset → `[]`. */
export function parseJsonStringArrayEnv({ envKey, raw }: { envKey: string; raw: string | undefined }): string[] {
  if (raw === undefined || raw.trim() === '') {
    return [];
  }
  try {
    return z.array(z.string()).parse(JSON.parse(raw));
  } catch (error) {
    throw new Error(`Environment variable ${envKey} must be a JSON string array`, { cause: error });
  }
}

/**
 * Parses `OIDC_ALLOWED_EMAILS`: comma-separated exact addresses and/or globs
 * (`*@company.com`). Empty / unset → no allowlist (any authenticated user may sign in).
 */
export function parseOidcAllowedEmails(raw: string | undefined): string[] {
  return parseCommaSeparatedEnvList(raw);
}

/**
 * Parses `TRUEFOUNDRY_TENANT_ID_TO_ALLOWED_MODEL_PROVIDER_ACCOUNTS` JSON.
 * Empty / unset → `{}` (no filtering).
 */
export function parseTenantIdToAllowedModelProviderAccounts(raw: string | undefined): Record<string, string[]> {
  if (raw === undefined || raw.trim() === '') {
    return {};
  }
  try {
    return z.record(z.string(), z.array(z.string())).parse(JSON.parse(raw));
  } catch (error) {
    throw new Error(
      'Environment variable TRUEFOUNDRY_TENANT_ID_TO_ALLOWED_MODEL_PROVIDER_ACCOUNTS must be a JSON object of tenant_id → string[]',
      { cause: error },
    );
  }
}

/**
 * Parsed `TRUEFOUNDRY_WEB_SEARCH_PROVIDER` JSON. Empty / unset → `undefined` (feature off).
 * Requires `name: "parallel"` and non-empty `api_key`.
 */
export interface TrueFoundryWebSearchProviderEnv {
  name: 'parallel';
  api_key: string;
}

export function parseTrueFoundryWebSearchProvider(
  raw: string | undefined,
): TrueFoundryWebSearchProviderEnv | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  try {
    const parsed = z.record(z.string(), z.string()).parse(JSON.parse(raw));
    const name = parsed['name']?.trim();
    const apiKey = parsed['api_key']?.trim();
    if (name !== 'parallel' || !apiKey) {
      throw new Error('missing or unsupported name, or missing api_key');
    }
    return { name: 'parallel', api_key: apiKey };
  } catch (error) {
    throw new Error(
      'Environment variable TRUEFOUNDRY_WEB_SEARCH_PROVIDER must be a JSON object with "name":"parallel" and non-empty "api_key" (e.g. {"name":"parallel","api_key":"..."})',
      { cause: error },
    );
  }
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

function parseNonNegativeInt(options: { envKey: string; raw: string | undefined; defaultValue: number }): number {
  const { envKey, raw, defaultValue } = options;
  if (raw === undefined || raw.trim() === '') {
    return defaultValue;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Environment variable ${envKey} must be a non-negative integer, got "${raw}"`);
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

function parsePostgresSchema(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_POSTGRES_SCHEMA;
  }
  const schema = raw.trim();
  if (!POSTGRES_SCHEMA_NAME_RE.test(schema)) {
    throw new Error(
      `Environment variable POSTGRES_SCHEMA must be a lowercase Postgres identifier ` +
        `(letter/underscore, then alnum/underscore, max 63 chars); got "${raw}"`,
    );
  }
  return schema;
}

/**
 * Empty stays empty. Otherwise parse as a URL, store without a trailing slash
 * (callers join with `/`), and reject query/hash or `.` / `..` path segments.
 */
function parsePublicBaseUrl(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === '') {
    return '';
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch (error) {
    throw new Error('PUBLIC_BASE_URL must be a valid URL', { cause: error });
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    throw new Error('PUBLIC_BASE_URL must not include a query or hash');
  }
  const segments = parsed.pathname.split('/').filter(part => part.length > 0);
  if (segments.some(part => part === '.' || part === '..')) {
    throw new Error('PUBLIC_BASE_URL path must not contain "." or ".." segments');
  }
  const path = segments.length === 0 ? '' : `/${segments.join('/')}`;
  return `${parsed.origin}${path}`;
}

function parseTrueFoundrySandboxProvider(
  raw: string | undefined,
): 'daytona' | 'truefoundry' | 'kubernetes' | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const value = raw.trim();
  if (value === 'daytona' || value === 'truefoundry' || value === 'kubernetes') {
    return value;
  }
  throw new Error(
    `Environment variable TRUEFOUNDRY_SANDBOX_PROVIDER must be "daytona", "truefoundry", or "kubernetes", got ${JSON.stringify(raw)}`,
  );
}

/** Parses `SENTRY_ADDITIONAL_TAGS` as a JSON object of string values. Unset/blank → `{}`. */
function parseSentryAdditionalTags(raw: string | undefined): Record<string, string> {
  if (raw === undefined || raw.trim() === '') {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error('SENTRY_ADDITIONAL_TAGS must be a JSON object of string values', { cause: error });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('SENTRY_ADDITIONAL_TAGS must be a JSON object of string values');
  }
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new Error(`SENTRY_ADDITIONAL_TAGS.${key} must be a string`);
    }
    tags[key] = value;
  }
  return tags;
}

/** Parses `POSTGRES_SSL_MODE`. Unset/blank → `''`. Unknown values throw. */
function validatePostgresSslMode(raw: string | undefined): PostgresSslMode | '' {
  const mode = raw?.trim() ?? '';
  if (!mode) {
    return '';
  }
  for (const allowed of POSTGRES_SSL_MODES) {
    if (mode === allowed) {
      return allowed;
    }
  }
  throw new Error(
    `Environment variable POSTGRES_SSL_MODE must be one of ${POSTGRES_SSL_MODES.join(', ')}; got "${mode}"`,
  );
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
function resolveSqlitePath(appDataDir: string): string {
  const override = getEnv('SQLITE_PATH');
  if (override !== undefined && override.trim() !== '') {
    return path.resolve(override);
  }
  return path.join(appDataDir, 'db', 'db.sqlite');
}

/** Parent for local sandbox roots. Same env-paths data dir as SQLite (`{suffix:''}`). */
function resolveLocalSandboxRootParent(appDataDir: string): string {
  return path.join(appDataDir, 'sandboxes');
}

/** Short tmp parent for Code Mode UDS socks (≤65 bytes after realpath). */
function resolveCodeModeSocketParent(): string {
  return path.join(os.tmpdir(), 'tf_cms');
}

/** Env string as-is, or undefined when unset/empty (no trimming). */
function optionalNonEmptyEnv(envKey: string): string | undefined {
  const raw = getEnv(envKey);
  if (raw === undefined || raw === '') {
    return undefined;
  }
  return raw;
}

/**
 * Build a standalone `redis://` URL from discrete host fields.
 * TLS stays on socket options (`REDIS_TLS_*`), not the URL scheme — CA/cert/key
 * cannot be expressed in `rediss://`, and mixing scheme + socket TLS is ambiguous.
 * IPv6 hosts are bracketed so `new URL()` accepts them; username/password are
 * percent-encoded by the URL setters.
 */
export function buildRedisStandaloneUrl(parts: {
  host: string;
  port: number;
  database: number;
  username: string | undefined;
  password: string | undefined;
}): string {
  const bareHost = parts.host.startsWith('[') && parts.host.endsWith(']') ? parts.host.slice(1, -1) : parts.host;
  const host = isIPv6(bareHost) ? `[${bareHost}]` : bareHost;
  const url = new URL(`redis://${host}:${String(parts.port)}/${String(parts.database)}`);
  if (parts.username !== undefined) {
    url.username = parts.username;
  }
  if (parts.password !== undefined) {
    url.password = parts.password;
  }
  return url.href;
}

/**
 * Exactly one Redis transport when configured.
 * Transports are mutually exclusive: Sentinel, `REDIS_URL`, or `REDIS_HOST`.
 * Returns undefined when none are set so controller / migrate can boot without Redis;
 * the server fails at connect time if still unset.
 */
function resolveRedisConnection(): RedisConnection | undefined {
  const sentinelEnabled = parseBoolean({
    envKey: 'REDIS_SENTINEL_ENABLED',
    raw: getEnv('REDIS_SENTINEL_ENABLED'),
    defaultValue: false,
  });
  const url = optionalNonEmptyEnv('REDIS_URL');
  const host = optionalNonEmptyEnv('REDIS_HOST');
  const database = parseNonNegativeInt({
    envKey: 'REDIS_DB',
    raw: getEnv('REDIS_DB'),
    defaultValue: 0,
  });
  const username = optionalNonEmptyEnv('REDIS_USERNAME');
  const password = getEnv('REDIS_PASSWORD');
  const passwordOrUndefined = password === undefined || password === '' ? undefined : password;

  if (sentinelEnabled) {
    const nodes = optionalNonEmptyEnv('REDIS_SENTINEL_NODES');
    const masterName = optionalNonEmptyEnv('REDIS_SENTINEL_MASTER_NAME');
    if (!nodes || !masterName || parseRedisSentinelNodes(nodes).length === 0) {
      throw new Error(
        'REDIS_SENTINEL_ENABLED=true requires non-empty REDIS_SENTINEL_NODES and REDIS_SENTINEL_MASTER_NAME.',
      );
    }
    if (url !== undefined || host !== undefined) {
      throw new Error(
        'Redis transports are mutually exclusive: unset REDIS_URL and REDIS_HOST when REDIS_SENTINEL_ENABLED=true.',
      );
    }
    const sentinelUsername = optionalNonEmptyEnv('REDIS_SENTINEL_USERNAME');
    const sentinelPasswordRaw = getEnv('REDIS_SENTINEL_PASSWORD');
    const sentinelPassword =
      sentinelPasswordRaw === undefined || sentinelPasswordRaw === '' ? undefined : sentinelPasswordRaw;
    return {
      mode: 'sentinel',
      nodes,
      masterName,
      database,
      ...(username !== undefined ? { username } : {}),
      ...(passwordOrUndefined !== undefined ? { password: passwordOrUndefined } : {}),
      ...(sentinelUsername !== undefined ? { sentinelUsername } : {}),
      ...(sentinelPassword !== undefined ? { sentinelPassword } : {}),
    };
  }

  if (url !== undefined && host !== undefined) {
    throw new Error(
      'Redis transports are mutually exclusive: set only one of REDIS_URL or REDIS_HOST (or enable Sentinel).',
    );
  }
  if (url !== undefined) {
    return { mode: 'standalone', url };
  }
  if (host !== undefined) {
    const port = parsePositiveInt({
      envKey: 'REDIS_PORT',
      raw: getEnv('REDIS_PORT'),
      defaultValue: 6379,
    });
    return {
      mode: 'standalone',
      url: buildRedisStandaloneUrl({
        host,
        port,
        database,
        username,
        password: passwordOrUndefined,
      }),
    };
  }

  return undefined;
}

/**
 * Postgres connection string for distributed mode.
 * Prefers `DATABASE_URL` when set (Railway / managed Postgres); otherwise builds from `POSTGRES_*`.
 * TLS is not put on the URL — see `resolvePostgresSsl` / `DATABASE_SSL` (servicefoundry-style).
 */
function resolvePostgresDatabaseUrl(): string {
  const databaseUrl = getEnv('DATABASE_URL');
  if (databaseUrl !== undefined && databaseUrl.trim() !== '') {
    return databaseUrl.trim();
  }

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
      'Set DATABASE_URL, or set non-empty POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, and POSTGRES_HOST when STANDALONE=false.',
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

/**
 * Postgres TLS for the pg Pool — same shape as servicefoundry `getSSLConfig`.
 * Env: `POSTGRES_SSL_MODE`, `POSTGRES_SSL_CERT_PATH`, `POSTGRES_SSL_KEY_PATH`, `POSTGRES_SSL_CA_PATH`.
 * Not written into `DATABASE_URL`. `prefer` / `require` / `verify-ca` / `verify-full` all map to
 * `ssl: true` (or the cert object); use `no-verify` for encrypt-without-verify.
 */
function resolvePostgresSsl(): boolean | PostgresSslConfig {
  const sslMode = getEnv('POSTGRES_SSL_MODE');
  const cert = readOptionalFileContentsEnv('POSTGRES_SSL_CERT_PATH');
  const key = readOptionalFileContentsEnv('POSTGRES_SSL_KEY_PATH');
  // Cloud SQL / private CA often fail verify-full; Node cannot express verify-ca without hostname check.
  const ca = readOptionalFileContentsEnv('POSTGRES_SSL_CA_PATH');

  let ssl: boolean | PostgresSslConfig = false;
  if (cert || key || ca) {
    ssl = {
      ...(cert ? { cert } : {}),
      ...(key ? { key } : {}),
      ...(ca ? { ca } : {}),
    };
  }

  switch (validatePostgresSslMode(sslMode)) {
    case 'disable':
      return false;
    case 'prefer':
    case 'require':
    case 'verify-ca':
    case 'verify-full':
      return ssl || true;
    case 'no-verify':
      return { ...(ssl || {}), rejectUnauthorized: false };
    default:
      return ssl;
  }
}

/** Reads a PEM file from an optional path env; unset/blank → `undefined`. */
function readOptionalFileContentsEnv(envKey: string): string | undefined {
  const filePath = resolveOptionalPathEnv(envKey);
  return filePath ? readFileSync(filePath, 'utf8') : undefined;
}

/** Builds a Postgres connection URL from discrete `POSTGRES_*` parts (no TLS query params). */
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
    OIDC_USER_DISPLAY_NAME_CLAIM:
      getEnv('OIDC_USER_DISPLAY_NAME_CLAIM', { defaultValue: DEFAULT_OIDC_USER_DISPLAY_NAME_CLAIM }) ??
      DEFAULT_OIDC_USER_DISPLAY_NAME_CLAIM,
    OIDC_USER_ROLE_CLAIM:
      getEnv('OIDC_USER_ROLE_CLAIM', { defaultValue: DEFAULT_OIDC_USER_ROLE_CLAIM }) ?? DEFAULT_OIDC_USER_ROLE_CLAIM,
    OIDC_ADMIN_ROLE_VALUE:
      getEnv('OIDC_ADMIN_ROLE_VALUE', { defaultValue: DEFAULT_OIDC_ADMIN_ROLE_VALUE }) ?? DEFAULT_OIDC_ADMIN_ROLE_VALUE,
    OIDC_SCOPES: parseOidcScopes(getEnv('OIDC_SCOPES', { defaultValue: DEFAULT_OIDC_SCOPES }) ?? DEFAULT_OIDC_SCOPES),
    OIDC_ALLOWED_EMAILS: parseOidcAllowedEmails(getEnv('OIDC_ALLOWED_EMAILS')),
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
  /** Claim used as the display name; e.g. "name" or "preferred_username".
   * Optional; defaults to "name". Missing/empty falls back to the user reference.
   * Env: `OIDC_USER_DISPLAY_NAME_CLAIM`.
   */
  OIDC_USER_DISPLAY_NAME_CLAIM: string;
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
  /**
   * Optional allowlist of emails that may sign in. Env: `OIDC_ALLOWED_EMAILS`.
   * Comma-separated exact addresses and/or `*` globs (e.g. `alice@acme.com,*@partner.com`).
   * Matching is case-insensitive against the ID token `email` claim. Empty = unrestricted.
   */
  OIDC_ALLOWED_EMAILS: string[];
}

export interface SharedServerConfiguration {
  /** Log level. Env: `LOG_LEVEL`. */
  LOG_LEVEL: string;
  /** Log one line per HTTP request (except `/healthz` and `/assets/`). Env: `ACCESS_LOGS`. Default true. */
  ACCESS_LOGS: boolean;
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
   * Optional override for the web-search catalog YAML (discovery presets for
   * GET /catalogs/web-search-providers). When unset, the catalog inlined at build
   * time is used. Env: `WEB_SEARCH_CATALOG_PATH`.
   */
  WEB_SEARCH_CATALOG_PATH: string | undefined;
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
  /** Max bytes for one remote MCP tool-call HTTP response body (not GET SSE). Env: `MCP_TOOL_CALL_MAX_RESPONSE_BYTES`. Default 50 MB. */
  MCP_TOOL_CALL_MAX_RESPONSE_BYTES: number;
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
  /**
   * Public application URL (origin plus optional pathname). Used as the origin of
   * MCP OAuth and OIDC callbacks; the pathname is the UI/API public prefix when
   * a reverse proxy strips it. Optional at boot; MCP OAuth and OIDC callback
   * construction fail if empty outside standalone development. Env: `PUBLIC_BASE_URL`.
   */
  PUBLIC_BASE_URL: string;
  /**
   * Base URL the controller uses to reach the server's HTTP API. Dedicated controller
   * (`STANDALONE=false`, `dist/controller-main.js`) and the in-process standalone controller
   * both call the server over HTTP(S) at this URL (loopback in standalone). When
   * `MTLS_ENABLED` is true the controller upgrades an `http://` URL to `https://`
   * and presents the client cert. Env: `SERVER_URL`.
   * Default: `http://localhost:$PORT`; in-cluster deployments MUST point this at the server Service.
   */
  SERVER_URL: string;
  /**
   * Service credential for controller calls.
   * Env: `TRUEFORGE_API_KEY`. Required and non-empty when `STANDALONE=false`.
   * Standalone defaults to {@link STANDALONE_TRUEFORGE_API_KEY} (local testing only).
   */
  TRUEFORGE_API_KEY: string;
  /**
   * Mutual TLS for this process's HTTPS listener and controller→server. When true, serves HTTPS
   * with client-cert enforcement (except `/healthz`) and the controller presents a client cert.
   * Env: `MTLS_ENABLED`. Default false.
   */
  MTLS_ENABLED: boolean;
  /**
   * Directory holding the TLS cert triple (`tls.crt` / `tls.key` / `ca.crt`) when
   * `MTLS_ENABLED` is true. Env: `MTLS_CERTS_DIR`. Default `/etc/tls`.
   */
  MTLS_CERTS_DIR: string;
  /** Env: `NETWORK_POLICY_ENABLED`. Default true. `false` skips the outbound URL guard. */
  NETWORK_POLICY_ENABLED: boolean;
  /** Hosts always allowed. Env: `OUTBOUND_URL_ALLOWED_HOSTS` (JSON string array). Empty = none. */
  OUTBOUND_URL_ALLOWED_HOSTS: string[];
  /** Hosts always blocked. Env: `OUTBOUND_URL_BLOCKED_HOSTS` (JSON string array). Empty = none. */
  OUTBOUND_URL_BLOCKED_HOSTS: string[];
  SENTRY_ENABLED: boolean;
  SENTRY_DSN: string | undefined;
  SENTRY_ADDITIONAL_TAGS: Record<string, string>;
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
   * Postgres connection string. Env: `DATABASE_URL` when set; otherwise built from `POSTGRES_*`.
   * Form: `postgres://USER:PASSWORD@HOST:PORT/DB` (or `postgresql://…`) with user/password URL-encoded.
   * TLS is not encoded here — see `DATABASE_SSL`.
   */
  DATABASE_URL: string;
  /**
   * Postgres TLS for the pg Pool (servicefoundry-style).
   * Env: `POSTGRES_SSL_MODE`, `POSTGRES_SSL_CERT_PATH`, `POSTGRES_SSL_KEY_PATH`, `POSTGRES_SSL_CA_PATH`.
   */
  DATABASE_SSL: boolean | PostgresSslConfig;
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
  /**
   * Postgres schema for app tables and Kysely migration bookkeeping (`search_path`, Migrator).
   * Env: `POSTGRES_SCHEMA`. Default `trueforge`.
   */
  POSTGRES_SCHEMA: string;
  /**
   * Resolved Redis transport (exactly one of url / host / sentinel), or undefined.
   * Required for the server process; optional for controller / migrate (no peering).
   * Env: mutually exclusive `REDIS_URL`, `REDIS_HOST`, or `REDIS_SENTINEL_*`.
   */
  REDIS_CONNECTION: RedisConnection | undefined;
  /** Socket connect timeout for Redis clients. Env: `REDIS_CONNECT_TIMEOUT_MS`. Default 20000. */
  REDIS_CONNECT_TIMEOUT_MS: number;
  /** Client ping interval for Redis keepalive. Env: `REDIS_PING_INTERVAL_MS`. Default 5000. */
  REDIS_PING_INTERVAL_MS: number;
  /** Enable TLS for Redis (and Sentinel when used). Env: `REDIS_TLS_ENABLED`. Default false. */
  REDIS_TLS_ENABLED: boolean;
  /** CA cert path or inline PEM. Env: `REDIS_TLS_CA_CERT`. */
  REDIS_TLS_CA_CERT: string | undefined;
  /** Verify server cert. Env: `REDIS_TLS_REJECT_UNAUTHORIZED`. Default true. */
  REDIS_TLS_REJECT_UNAUTHORIZED: boolean;
  /** TLS SNI server name. Env: `REDIS_TLS_SERVERNAME`. */
  REDIS_TLS_SERVERNAME: string | undefined;
  /** Client cert path or inline PEM (mTLS). Env: `REDIS_TLS_CERT`. */
  REDIS_TLS_CERT: string | undefined;
  /** Client key path or inline PEM (mTLS). Env: `REDIS_TLS_KEY`. */
  REDIS_TLS_KEY: string | undefined;
  /** Client key passphrase. Env: `REDIS_TLS_KEY_PASSPHRASE`. */
  REDIS_TLS_KEY_PASSPHRASE: string | undefined;
  /**
   * OIDC configuration for server authentication.
   * Undefined means browser login is disabled.
   */
  OIDC: OIDCConfig | undefined;
  /**
   * When set, models/MCP/agents are backed by the TrueFoundry ServiceFoundry server with the
   * caller's token. Unset = local Postgres stores. Mutually exclusive with OIDC.
   * Env: `TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL`.
   */
  /**
   * When set, automatically move public TrueForge tables into `POSTGRES_SCHEMA` on first bootstrap.
   * Env: `AUTOMATICALLY_MOVE_TRUEFORGE_TABLES_FROM_PUBLIC_TO_TRUEFORGE_SCHEMA`. Default true.
   */
  AUTOMATICALLY_MOVE_TRUEFORGE_TABLES_FROM_PUBLIC_TO_TRUEFORGE_SCHEMA: boolean;
  /**
   * The URL of the TrueFoundry ServiceFoundry server.
   * Env: `TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL`.
   */
  TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL: string | undefined;
  /**
   * Required when `TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL` is set. Env: `TRUEFOUNDRY_API_KEY`.
   */
  TRUEFOUNDRY_API_KEY: string | undefined;
  /** Max ms for non-agent ServiceFoundry HTTP calls. Env: `TRUEFOUNDRY_SERVICEFOUNDRY_HTTP_TIMEOUT_MS`. Default 10000. */
  TRUEFOUNDRY_SERVICEFOUNDRY_HTTP_TIMEOUT_MS: number;
  /** Max ms for agent CRUD ServiceFoundry HTTP calls. Env: `TRUEFOUNDRY_SERVICEFOUNDRY_HTTP_AGENT_TIMEOUT_MS`. Default 3000. */
  TRUEFOUNDRY_SERVICEFOUNDRY_HTTP_AGENT_TIMEOUT_MS: number;
  /**
   * Present this pod's client certificate on outbound calls to the ServiceFoundry server (internal
   * mutual TLS) and upgrade a mesh-direct peer URL from http to https. Off by default, so an
   * unconfigured deployment keeps calling over plain HTTP exactly as before.
   * Env: `TRUEFOUNDRY_MTLS_ENABLED`. Default false.
   */
  TRUEFOUNDRY_MTLS_ENABLED: boolean;
  /**
   * Directory holding the internal mTLS material used when `TRUEFOUNDRY_MTLS_ENABLED` is true — the
   * cert triple `tls.crt` / `tls.key` / `ca.crt`, so one chart value configures every component.
   * Env: `TRUEFOUNDRY_MTLS_CERTS_DIR`. Default `/etc/tls/truefoundry`.
   */
  TRUEFOUNDRY_MTLS_CERTS_DIR: string;
  /**
   * When TrueFoundry mode is on, enable the shared sandbox for all tenants
   * (no per-tenant PUT). Env: `TRUEFOUNDRY_SANDBOX_ENABLED`. Default false.
   */
  TRUEFOUNDRY_SANDBOX_ENABLED: boolean;
  /**
   * Shared sandbox backend when `TRUEFOUNDRY_SANDBOX_ENABLED` is true.
   * Env: `TRUEFOUNDRY_SANDBOX_PROVIDER` (`daytona` | `truefoundry`).
   */
  TRUEFOUNDRY_SANDBOX_PROVIDER: 'daytona' | 'truefoundry' | 'kubernetes' | undefined;
  /**
   * Shared API key (required for Daytona; optional for truefoundry).
   * Env: `TRUEFOUNDRY_SANDBOX_API_KEY`.
   */
  TRUEFOUNDRY_SANDBOX_API_KEY: string | undefined;
  /**
   * TrueFoundry (on-prem) sandbox HTTP server URL when provider is `truefoundry`.
   * Env: `TRUEFOUNDRY_SANDBOX_SERVER_URL`.
   */
  TRUEFOUNDRY_SANDBOX_SERVER_URL: string | undefined;
  /**
   * Static JSON settings for the shared sandbox (provider-specific).
   * Daytona: `snapshotName`, intervals, `timeoutMs`. TrueFoundry: `nats_bridge_url`.
   * Env: `TRUEFOUNDRY_SANDBOX_SETTINGS`.
   */
  TRUEFOUNDRY_SANDBOX_SETTINGS: string | undefined;
  /** Kubernetes namespace for env-synthesized sandbox resources. Env: `KUBERNETES_SANDBOX_NAMESPACE`. */
  KUBERNETES_SANDBOX_NAMESPACE: string;
  /** Optional Kubernetes service account for sandbox pods. Env: `KUBERNETES_SANDBOX_SERVICE_ACCOUNT_NAME`. */
  KUBERNETES_SANDBOX_SERVICE_ACCOUNT_NAME: string | undefined;
  /** Optional image pull secret for sandbox pods. Env: `KUBERNETES_SANDBOX_IMAGE_PULL_SECRET_NAME`. */
  KUBERNETES_SANDBOX_IMAGE_PULL_SECRET_NAME: string | undefined;
  /** Optional JSON resource requests/limits. Env: `KUBERNETES_SANDBOX_RESOURCES`. */
  KUBERNETES_SANDBOX_RESOURCES: string | undefined;
  /** Default Kubernetes sandbox command timeout. Env: `KUBERNETES_SANDBOX_EXEC_TIMEOUT_MS`. */
  KUBERNETES_SANDBOX_EXEC_TIMEOUT_MS: number;
  /** Poll interval while waiting for a sandbox pod. Env: `KUBERNETES_SANDBOX_POLL_INTERVAL_MS`. */
  KUBERNETES_SANDBOX_POLL_INTERVAL_MS: number;
  /** Maximum time to wait for a sandbox to become ready. Env: `KUBERNETES_SANDBOX_CREATE_TIMEOUT_MS`. */
  KUBERNETES_SANDBOX_CREATE_TIMEOUT_MS: number;
  /** TTL for server-side stale sandbox cleanup. Env: `KUBERNETES_SANDBOX_REAPER_TTL_MS`. */
  KUBERNETES_SANDBOX_REAPER_TTL_MS: number;
  /** Whether the TrueForge process runs inside the Kubernetes cluster. Env: `KUBERNETES_SANDBOX_IN_CLUSTER`. */
  KUBERNETES_SANDBOX_IN_CLUSTER: boolean;
  /**
   * Optional per-tenant allowlist of model provider account names. JSON object
   * `Record<tenant_id, account_name[]>`. Empty / unset → no filtering. Tenants omitted from the
   * map are unaffected; tenants present are limited to the listed provider accounts.
   * Env: `TRUEFOUNDRY_TENANT_ID_TO_ALLOWED_MODEL_PROVIDER_ACCOUNTS`.
   */
  TRUEFOUNDRY_TENANT_ID_TO_ALLOWED_MODEL_PROVIDER_ACCOUNTS: Record<string, string[]>;
  /**
   * Optional built-in web search provider (TrueFoundry mode only). JSON object
   * `Record<string, string>` with `name` (`parallel`) and `api_key`.
   * Unset / empty → web search tools are not registered. Env: `TRUEFOUNDRY_WEB_SEARCH_PROVIDER`.
   */
  TRUEFOUNDRY_WEB_SEARCH_PROVIDER: TrueFoundryWebSearchProviderEnv | undefined;
  TRUEFOUNDRY_AUTH_SERVER_URL: string | undefined;
  TRUEFOUNDRY_TENANT_NAME: string | undefined;
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

const appDataDirSuffix = getEnv('APP_DATA_DIR_SUFFIX', { defaultValue: '' }) ?? '';
const appDataDir = envPaths(ENV_PATHS_APP_NAME, { suffix: appDataDirSuffix }).data;

const port = parsePort(getEnv('PORT'));
const host = getEnv('HOST', { defaultValue: DEFAULT_HOST }) ?? DEFAULT_HOST;

const shared: SharedServerConfiguration = {
  LOG_LEVEL: getEnv('LOG_LEVEL', { defaultValue: 'info' }) ?? 'info',
  ACCESS_LOGS: parseBoolean({ envKey: 'ACCESS_LOGS', raw: getEnv('ACCESS_LOGS'), defaultValue: true }),
  NODE_ENV: getEnv('NODE_ENV'),
  PORT: port,
  HOST: host,
  EXECUTOR_ID: standalone ? LOCAL_EXECUTOR_ID : randomAlphanumeric(6),
  MODEL_CATALOG_PATH: resolveOptionalPathEnv('MODEL_CATALOG_PATH'),
  MCP_CATALOG_PATH: resolveOptionalPathEnv('MCP_CATALOG_PATH'),
  SKILL_CATALOG_PATH: resolveOptionalPathEnv('SKILL_CATALOG_PATH'),
  SANDBOX_CATALOG_PATH: resolveOptionalPathEnv('SANDBOX_CATALOG_PATH'),
  WEB_SEARCH_CATALOG_PATH: resolveOptionalPathEnv('WEB_SEARCH_CATALOG_PATH'),
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
  MCP_TOOL_CALL_MAX_RESPONSE_BYTES: parsePositiveInt({
    envKey: 'MCP_TOOL_CALL_MAX_RESPONSE_BYTES',
    raw: getEnv('MCP_TOOL_CALL_MAX_RESPONSE_BYTES'),
    defaultValue: 50 * 1024 * 1024,
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
  PUBLIC_BASE_URL: parsePublicBaseUrl(getEnv('PUBLIC_BASE_URL', { defaultValue: '' })),
  SERVER_URL:
    getEnv('SERVER_URL', { defaultValue: `http://localhost:${String(port)}` }) ?? `http://localhost:${String(port)}`,
  TRUEFORGE_API_KEY: standalone
    ? (getEnv('TRUEFORGE_API_KEY', { defaultValue: STANDALONE_TRUEFORGE_API_KEY }) ?? STANDALONE_TRUEFORGE_API_KEY)
    : (getEnv('TRUEFORGE_API_KEY', { required: true }) ?? ''),
  MTLS_ENABLED: parseBoolean({
    envKey: 'MTLS_ENABLED',
    raw: getEnv('MTLS_ENABLED'),
    defaultValue: false,
  }),
  MTLS_CERTS_DIR: getEnv('MTLS_CERTS_DIR', { defaultValue: '/etc/tls' }) ?? '/etc/tls',
  NETWORK_POLICY_ENABLED: parseBoolean({
    envKey: 'NETWORK_POLICY_ENABLED',
    raw: getEnv('NETWORK_POLICY_ENABLED'),
    defaultValue: true,
  }),
  OUTBOUND_URL_ALLOWED_HOSTS: parseJsonStringArrayEnv({
    envKey: 'OUTBOUND_URL_ALLOWED_HOSTS',
    raw: getEnv('OUTBOUND_URL_ALLOWED_HOSTS'),
  }),
  OUTBOUND_URL_BLOCKED_HOSTS: parseJsonStringArrayEnv({
    envKey: 'OUTBOUND_URL_BLOCKED_HOSTS',
    raw: getEnv('OUTBOUND_URL_BLOCKED_HOSTS'),
  }),
  SENTRY_ENABLED: parseBoolean({
    envKey: 'SENTRY_ENABLED',
    raw: getEnv('SENTRY_ENABLED'),
    defaultValue: false,
  }),
  SENTRY_DSN: getEnv('SENTRY_DSN', { required: false }),
  SENTRY_ADDITIONAL_TAGS: parseSentryAdditionalTags(getEnv('SENTRY_ADDITIONAL_TAGS', { required: false })),
};

const configuration: ServerConfiguration = standalone
  ? {
      ...shared,
      STANDALONE: true,
      SQLITE_PATH: resolveSqlitePath(appDataDir),
      LOCAL_SANDBOX_ROOT_PARENT: resolveLocalSandboxRootParent(appDataDir),
      CODE_MODE_SOCKET_PARENT: resolveCodeModeSocketParent(),
    }
  : {
      ...shared,
      STANDALONE: false,
      DATABASE_URL: resolvePostgresDatabaseUrl(),
      DATABASE_SSL: resolvePostgresSsl(),
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
      POSTGRES_SCHEMA: parsePostgresSchema(getEnv('POSTGRES_SCHEMA')),
      REDIS_CONNECTION: resolveRedisConnection(),
      REDIS_CONNECT_TIMEOUT_MS: parsePositiveInt({
        envKey: 'REDIS_CONNECT_TIMEOUT_MS',
        raw: getEnv('REDIS_CONNECT_TIMEOUT_MS'),
        defaultValue: 20_000,
      }),
      REDIS_PING_INTERVAL_MS: parsePositiveInt({
        envKey: 'REDIS_PING_INTERVAL_MS',
        raw: getEnv('REDIS_PING_INTERVAL_MS'),
        defaultValue: 5_000,
      }),
      REDIS_TLS_ENABLED: parseBoolean({
        envKey: 'REDIS_TLS_ENABLED',
        raw: getEnv('REDIS_TLS_ENABLED'),
        defaultValue: false,
      }),
      REDIS_TLS_CA_CERT: getEnv('REDIS_TLS_CA_CERT'),
      REDIS_TLS_REJECT_UNAUTHORIZED: parseBoolean({
        envKey: 'REDIS_TLS_REJECT_UNAUTHORIZED',
        raw: getEnv('REDIS_TLS_REJECT_UNAUTHORIZED'),
        defaultValue: true,
      }),
      REDIS_TLS_SERVERNAME: getEnv('REDIS_TLS_SERVERNAME'),
      REDIS_TLS_CERT: getEnv('REDIS_TLS_CERT'),
      REDIS_TLS_KEY: getEnv('REDIS_TLS_KEY'),
      REDIS_TLS_KEY_PASSPHRASE: getEnv('REDIS_TLS_KEY_PASSPHRASE'),
      OIDC: resolveOIDCConfig(),
      AUTOMATICALLY_MOVE_TRUEFORGE_TABLES_FROM_PUBLIC_TO_TRUEFORGE_SCHEMA: parseBoolean({
        envKey: 'AUTOMATICALLY_MOVE_TRUEFORGE_TABLES_FROM_PUBLIC_TO_TRUEFORGE_SCHEMA',
        raw: getEnv('AUTOMATICALLY_MOVE_TRUEFORGE_TABLES_FROM_PUBLIC_TO_TRUEFORGE_SCHEMA'),
        defaultValue: true,
      }),
      TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL: getEnv('TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL', { required: false }),
      TRUEFOUNDRY_API_KEY: getEnv('TRUEFOUNDRY_API_KEY', { required: false }),
      TRUEFOUNDRY_SERVICEFOUNDRY_HTTP_TIMEOUT_MS: parsePositiveInt({
        envKey: 'TRUEFOUNDRY_SERVICEFOUNDRY_HTTP_TIMEOUT_MS',
        raw: getEnv('TRUEFOUNDRY_SERVICEFOUNDRY_HTTP_TIMEOUT_MS'),
        defaultValue: 10_000,
      }),
      TRUEFOUNDRY_SERVICEFOUNDRY_HTTP_AGENT_TIMEOUT_MS: parsePositiveInt({
        envKey: 'TRUEFOUNDRY_SERVICEFOUNDRY_HTTP_AGENT_TIMEOUT_MS',
        raw: getEnv('TRUEFOUNDRY_SERVICEFOUNDRY_HTTP_AGENT_TIMEOUT_MS'),
        defaultValue: 3_000,
      }),
      TRUEFOUNDRY_MTLS_ENABLED: parseBoolean({
        envKey: 'TRUEFOUNDRY_MTLS_ENABLED',
        raw: getEnv('TRUEFOUNDRY_MTLS_ENABLED'),
        defaultValue: false,
      }),
      TRUEFOUNDRY_MTLS_CERTS_DIR:
        getEnv('TRUEFOUNDRY_MTLS_CERTS_DIR', { defaultValue: '/etc/tls/truefoundry' }) ?? '/etc/tls/truefoundry',
      TRUEFOUNDRY_SANDBOX_ENABLED: parseBoolean({
        envKey: 'TRUEFOUNDRY_SANDBOX_ENABLED',
        raw: getEnv('TRUEFOUNDRY_SANDBOX_ENABLED'),
        defaultValue: false,
      }),
      TRUEFOUNDRY_SANDBOX_PROVIDER: parseTrueFoundrySandboxProvider(
        getEnv('TRUEFOUNDRY_SANDBOX_PROVIDER', { required: false }),
      ),
      TRUEFOUNDRY_SANDBOX_API_KEY: getEnv('TRUEFOUNDRY_SANDBOX_API_KEY', { required: false }),
      TRUEFOUNDRY_SANDBOX_SERVER_URL: getEnv('TRUEFOUNDRY_SANDBOX_SERVER_URL', { required: false }),
      TRUEFOUNDRY_SANDBOX_SETTINGS: getEnv('TRUEFOUNDRY_SANDBOX_SETTINGS', { required: false }),
      KUBERNETES_SANDBOX_NAMESPACE: getEnv('KUBERNETES_SANDBOX_NAMESPACE', { defaultValue: 'default' }) ?? 'default',
      KUBERNETES_SANDBOX_SERVICE_ACCOUNT_NAME: getEnv('KUBERNETES_SANDBOX_SERVICE_ACCOUNT_NAME', {
        required: false,
      }),
      KUBERNETES_SANDBOX_IMAGE_PULL_SECRET_NAME: getEnv('KUBERNETES_SANDBOX_IMAGE_PULL_SECRET_NAME', {
        required: false,
      }),
      KUBERNETES_SANDBOX_RESOURCES: getEnv('KUBERNETES_SANDBOX_RESOURCES', { required: false }),
      KUBERNETES_SANDBOX_EXEC_TIMEOUT_MS: parsePositiveInt({
        envKey: 'KUBERNETES_SANDBOX_EXEC_TIMEOUT_MS',
        raw: getEnv('KUBERNETES_SANDBOX_EXEC_TIMEOUT_MS'),
        defaultValue: 60_000,
      }),
      KUBERNETES_SANDBOX_POLL_INTERVAL_MS: parsePositiveInt({
        envKey: 'KUBERNETES_SANDBOX_POLL_INTERVAL_MS',
        raw: getEnv('KUBERNETES_SANDBOX_POLL_INTERVAL_MS'),
        defaultValue: 1_000,
      }),
      KUBERNETES_SANDBOX_CREATE_TIMEOUT_MS: parsePositiveInt({
        envKey: 'KUBERNETES_SANDBOX_CREATE_TIMEOUT_MS',
        raw: getEnv('KUBERNETES_SANDBOX_CREATE_TIMEOUT_MS'),
        defaultValue: 120_000,
      }),
      KUBERNETES_SANDBOX_REAPER_TTL_MS: parsePositiveInt({
        envKey: 'KUBERNETES_SANDBOX_REAPER_TTL_MS',
        raw: getEnv('KUBERNETES_SANDBOX_REAPER_TTL_MS'),
        defaultValue: 24 * 60 * 60 * 1000,
      }),
      KUBERNETES_SANDBOX_IN_CLUSTER: parseBoolean({
        envKey: 'KUBERNETES_SANDBOX_IN_CLUSTER',
        raw: getEnv('KUBERNETES_SANDBOX_IN_CLUSTER'),
        defaultValue: getEnv('KUBERNETES_SERVICE_HOST') !== undefined,
      }),
      TRUEFOUNDRY_TENANT_ID_TO_ALLOWED_MODEL_PROVIDER_ACCOUNTS: parseTenantIdToAllowedModelProviderAccounts(
        getEnv('TRUEFOUNDRY_TENANT_ID_TO_ALLOWED_MODEL_PROVIDER_ACCOUNTS', { required: false }),
      ),
      TRUEFOUNDRY_WEB_SEARCH_PROVIDER: parseTrueFoundryWebSearchProvider(
        getEnv('TRUEFOUNDRY_WEB_SEARCH_PROVIDER', { required: false }),
      ),
      TRUEFOUNDRY_AUTH_SERVER_URL: getEnv('TRUEFOUNDRY_AUTH_SERVER_URL', { required: false }),
      TRUEFOUNDRY_TENANT_NAME: getEnv('TRUEFOUNDRY_TENANT_NAME', { required: false }),
    };

export function isOidcConfigured(
  value: ServerConfiguration,
): value is DistributedServerConfiguration & { OIDC: OIDCConfig } {
  return !value.STANDALONE && value.OIDC !== undefined;
}

/**
 * TrueFoundry mode: ServiceFoundry-backed models/MCP/agents. Only available on
 * distributed config when `TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL` is set.
 */
export function isTrueFoundryModeEnabled(
  config: ServerConfiguration = configuration,
): config is DistributedServerConfiguration & { TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL: string } {
  return !config.STANDALONE && config.TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL !== undefined;
}

/**
 * Env-synthesized sandbox provider (Daytona/TrueFoundry/Kubernetes settings come from env, not
 * the DB) should be used in place of DB-backed settings. True in full TrueFoundry mode, and also
 * in a self-hosted distributed deployment that opts in via `TRUEFOUNDRY_SANDBOX_ENABLED` without
 * a TrueFoundry control-plane connection — needed for providers with no DB-backed settings path,
 * such as Kubernetes, which holds no credentials to store.
 */
export function isEnvSandboxProviderEnabled(
  config: ServerConfiguration = configuration,
): config is DistributedServerConfiguration {
  return !config.STANDALONE && config.TRUEFOUNDRY_SANDBOX_ENABLED;
}

/** Runtime auth/integration mode for this process. */
export enum TrueForgeAuthMode {
  Standalone = 'standalone',
  Oidc = 'oidc',
  TrueFoundry = 'truefoundry',
}

/**
 * Resolve the active {@link TrueForgeAuthMode} from configuration.
 * TrueFoundry wins over OIDC when both would otherwise be set (startup already rejects that combo).
 */
export function getTrueForgeAuthMode(config: ServerConfiguration = configuration): TrueForgeAuthMode {
  if (isTrueFoundryModeEnabled(config)) {
    return TrueForgeAuthMode.TrueFoundry;
  }
  if (isOidcConfigured(config)) {
    return TrueForgeAuthMode.Oidc;
  }
  return TrueForgeAuthMode.Standalone;
}

if (isTrueFoundryModeEnabled(configuration)) {
  // TrueFoundry authenticates each caller with their own gateway token, so browser SSO must be off.
  if (isOidcConfigured(configuration)) {
    throw new Error(
      'TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL (TrueFoundry mode) and OIDC (SSO) cannot both be enabled at once.',
    );
  }
  // TRUEFOUNDRY_API_KEY is required when TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL is set.
  if (configuration.TRUEFOUNDRY_API_KEY === undefined) {
    throw new Error('TRUEFOUNDRY_API_KEY is required when TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL is set.');
  }
}

// Shared sandbox — env-synthesized in full TrueFoundry mode, or in a self-hosted distributed
// deployment that opts in without a TrueFoundry control-plane connection (see
// `isEnvSandboxProviderEnabled`).
if (isEnvSandboxProviderEnabled(configuration)) {
  if (configuration.TRUEFOUNDRY_SANDBOX_PROVIDER === undefined) {
    throw new Error(
      'TRUEFOUNDRY_SANDBOX_ENABLED is true but TRUEFOUNDRY_SANDBOX_PROVIDER is not set. ' +
        'Set TRUEFOUNDRY_SANDBOX_PROVIDER to "daytona", "truefoundry", or "kubernetes", or set TRUEFOUNDRY_SANDBOX_ENABLED=false.',
    );
  }
  if (
    configuration.TRUEFOUNDRY_SANDBOX_SETTINGS === undefined &&
    configuration.TRUEFOUNDRY_SANDBOX_PROVIDER !== 'kubernetes'
  ) {
    throw new Error(
      'TRUEFOUNDRY_SANDBOX_ENABLED is true but TRUEFOUNDRY_SANDBOX_SETTINGS is not set. ' +
        'Provide a JSON settings object, or set TRUEFOUNDRY_SANDBOX_ENABLED=false.',
    );
  }
  try {
    JSON.parse(configuration.TRUEFOUNDRY_SANDBOX_SETTINGS ?? '{}');
  } catch (error) {
    throw new Error('TRUEFOUNDRY_SANDBOX_SETTINGS must be valid JSON', { cause: error });
  }
  if (
    configuration.TRUEFOUNDRY_SANDBOX_PROVIDER === 'daytona' &&
    configuration.TRUEFOUNDRY_SANDBOX_API_KEY === undefined
  ) {
    throw new Error(
      'TRUEFOUNDRY_SANDBOX_PROVIDER=daytona requires TRUEFOUNDRY_SANDBOX_API_KEY, or set TRUEFOUNDRY_SANDBOX_ENABLED=false.',
    );
  }
  if (
    configuration.TRUEFOUNDRY_SANDBOX_PROVIDER === 'truefoundry' &&
    configuration.TRUEFOUNDRY_SANDBOX_SERVER_URL === undefined
  ) {
    throw new Error(
      'TRUEFOUNDRY_SANDBOX_PROVIDER=truefoundry requires TRUEFOUNDRY_SANDBOX_SERVER_URL, or set TRUEFOUNDRY_SANDBOX_ENABLED=false.',
    );
  }
}

if (!configuration.STANDALONE && configuration.TRUEFORGE_API_KEY.trim() === '') {
  throw new Error('TRUEFORGE_API_KEY must not be empty when STANDALONE=false.');
}

/**
 * Effective public application URL. Empty `PUBLIC_BASE_URL` stays empty
 * (callers that need a callback origin throw).
 */
function effectivePublicBaseUrl(config: ServerConfiguration): string {
  // Standalone production is one process on $PORT. Ignore a leftover Vite
  // PUBLIC_BASE_URL (e.g. http://localhost:3000) from the shared .env.
  if (config.STANDALONE && config.NODE_ENV !== 'development') {
    return `http://localhost:${String(config.PORT)}`;
  }
  return config.PUBLIC_BASE_URL;
}

/**
 * Public origin for OAuth callbacks.
 * Standalone (non-development) → `http://localhost:$PORT`; otherwise `PUBLIC_BASE_URL`
 * (required in development and distributed; throws if empty).
 */
export function getPublicBaseUrl(config: ServerConfiguration = configuration): string {
  const publicBaseUrl = effectivePublicBaseUrl(config);
  if (publicBaseUrl === '') {
    throw new Error('PUBLIC_BASE_URL is required for OIDC callbacks but was empty');
  }
  return publicBaseUrl;
}

/** `/` or `/custom/proxy/path/` — trailing slash for asset URLs and the boot script. Empty / standalone non-dev → `/`. */
export function getPublicUiBasePath(config: ServerConfiguration = configuration): string {
  const publicBaseUrl = effectivePublicBaseUrl(config);
  if (publicBaseUrl === '') {
    return '/';
  }
  const path = new URL(publicBaseUrl).pathname;
  return path === '/' ? '/' : `${path}/`;
}

export default configuration;
