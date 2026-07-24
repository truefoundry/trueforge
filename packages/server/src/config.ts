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

  if (process.env['NODE_ENV'] !== 'test' && options?.required) {
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
export const parsePositiveInt = (envKey: string, raw: string | undefined, defaultValue: number): number => {
  if (raw === undefined || raw.trim() === '') {
    return defaultValue;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Environment variable ${envKey} must be a positive integer, got "${raw}"`);
  }
  return value;
};

// ============================================================================
// CONFIGURATION INTERFACE
// ============================================================================

export const DEFAULT_PORT = 8790;

export interface ServerConfiguration {
  /** HTTP port the server listens on. Env: `PORT`. */
  PORT: number;
  /**
   * Absolute path to the directory containing the YAML config files
   * (models.yaml, mcp.yaml, skills.yaml). Relative values are resolved
   * against the working directory. Env: `REGISTRY_DIR`, defaults to
   * `./registry`.
   */
  REGISTRY_DIR: string;
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
}

// ============================================================================
// CONFIGURATION VALUES
// ============================================================================

const configuration: ServerConfiguration = {
  PORT: parsePort(getEnv('PORT')),
  REGISTRY_DIR: path.resolve(getEnv('REGISTRY_DIR', { defaultValue: 'registry' }) ?? 'registry'),
  MODEL_API_KEY: getEnv('MODEL_API_KEY', { required: true }) ?? '',
  MODEL_API_KEY_BY_NAME: parseApiKeysByName(),
  MODEL_HEADERS: parseHeaders('MODEL_HEADERS', getEnv('MODEL_HEADERS')),
  MODEL_HEADERS_BY_NAME: parseHeadersByName('MODEL'),
  MCP_HEADERS: parseHeaders('MCP_HEADERS', getEnv('MCP_HEADERS')),
  MCP_HEADERS_BY_NAME: parseHeadersByName('MCP'),
  SANDBOX_SETTINGS: getEnv('SANDBOX_SETTINGS'),
  SANDBOX_API_KEY: getEnv('SANDBOX_API_KEY'),
  SANDBOX_FILE_MAX_BYTES: parsePositiveInt('SANDBOX_FILE_MAX_BYTES', getEnv('SANDBOX_FILE_MAX_BYTES'), 20_971_520),
  SANDBOX_PREVIEW_URL_EXPIRY_SECONDS: parsePositiveInt(
    'SANDBOX_PREVIEW_URL_EXPIRY_SECONDS',
    getEnv('SANDBOX_PREVIEW_URL_EXPIRY_SECONDS'),
    3600,
  ),
} as const;

export default configuration;
