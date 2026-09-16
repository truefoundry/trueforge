/**
 * Primary Redis connection, owned by the server: created and connected at
 * boot, closed last during shutdown. Injected into the request-reply
 * transport (which duplicates it only for its subscriber in standalone mode;
 * Sentinel shares the same client for pub/sub).
 */
import { existsSync, readFileSync } from 'node:fs';

import { extractErrorLogFields } from '@truefoundry/trueforge-core/core';
import type { RedisPeerClient } from '@truefoundry/trueforge-core/request-reply';
import { createClient, createSentinel, type RedisClientType } from 'redis';
import type { Logger } from 'winston';

const DEFAULT_SENTINEL_PORT = 26379;
const DEFAULT_REDIS_PORT = 6379;
const DEFAULT_REDIS_DB = 0;
const CONNECT_TIMEOUT_MS = 20_000;
const PING_INTERVAL_MS = 5_000;
const SENTINEL_RETRY_BASE_MS = 200;
const SENTINEL_RETRY_MAX_MS = 3_000;

/** Parse comma-separated `host:port` list into Sentinel root nodes. */
export function parseRedisSentinelNodes(raw: string): { host: string; port: number }[] {
  return raw
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const lastColon = entry.lastIndexOf(':');
      if (lastColon === -1) {
        return { host: entry, port: DEFAULT_SENTINEL_PORT };
      }
      const host = entry.slice(0, lastColon);
      const parsedPort = Number.parseInt(entry.slice(lastColon + 1), 10);
      return { host, port: Number.isNaN(parsedPort) ? DEFAULT_SENTINEL_PORT : parsedPort };
    });
}

/** Sentinel is active only when explicitly enabled and fully configured. */
export function isRedisSentinelConfigured(
  input:
    | {
        enabled: boolean | undefined;
        nodes: string | undefined;
        masterName: string | undefined;
      }
    | undefined,
): boolean {
  return !!(
    input?.enabled &&
    input.masterName?.trim() &&
    input.nodes?.trim() &&
    parseRedisSentinelNodes(input.nodes).length
  );
}

export interface RedisTlsInput {
  enabled: boolean | undefined;
  caCert: string | undefined;
  rejectUnauthorized: boolean | undefined;
  serverName: string | undefined;
  cert: string | undefined;
  key: string | undefined;
  keyPassphrase: string | undefined;
}

export function isStandaloneRedisClient(client: RedisPeerClient): client is RedisClientType {
  return 'duplicate' in client;
}

const PEM_MARKER = '-----BEGIN';

function resolvePemMaterial(value: string, label: string): string {
  if (value.includes(PEM_MARKER)) {
    return value;
  }
  if (existsSync(value)) {
    try {
      return readFileSync(value, 'utf8');
    } catch (error) {
      throw new Error(
        `[Redis] Failed to read ${label} from path "${value}": ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  throw new Error(`[Redis] ${label} is neither a readable file path nor inline PEM (no "${PEM_MARKER}" marker found).`);
}

/** Shared TLS socket options for data nodes and Sentinel clients. */
function buildTlsSocketOptions(tls: RedisTlsInput | undefined):
  | {
      tls: true;
      rejectUnauthorized: boolean;
      ca?: string;
      cert?: string;
      key?: string;
      passphrase?: string;
      servername?: string;
    }
  | undefined {
  if (!tls?.enabled) {
    return undefined;
  }
  if ((tls.cert && !tls.key) || (tls.key && !tls.cert)) {
    throw new Error(
      '[Redis] mTLS misconfigured: REDIS_TLS_CERT and REDIS_TLS_KEY must be set together ' +
        '(provide both for mutual TLS, or neither).',
    );
  }

  return {
    tls: true,
    rejectUnauthorized: tls.rejectUnauthorized ?? true,
    ...(tls.caCert ? { ca: resolvePemMaterial(tls.caCert, 'REDIS_TLS_CA_CERT') } : {}),
    ...(tls.cert ? { cert: resolvePemMaterial(tls.cert, 'REDIS_TLS_CERT') } : {}),
    ...(tls.key ? { key: resolvePemMaterial(tls.key, 'REDIS_TLS_KEY') } : {}),
    ...(tls.keyPassphrase ? { passphrase: tls.keyPassphrase } : {}),
    ...(tls.serverName ? { servername: tls.serverName } : {}),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Connect via Redis Sentinel with rebuild-and-retry.
 *
 * A standalone `createClient()` can recover from later socket drops via the
 * library's automatic reconnect. A Sentinel client cannot: if the first
 * `connect()` rejects, the instance is wedged (retrying `connect()` throws
 * "already attempting to open"). Discard and rebuild on each failed attempt;
 * only auth failures (`WRONGPASS` / `NOAUTH`) abort permanently.
 */
async function connectSentinelWithRetry(input: {
  sentinel: {
    nodes: string | undefined;
    masterName: string | undefined;
    username: string | undefined;
    password: string | undefined;
  };
  auth: { database: number; username?: string; password?: string };
  clientDefaults: { disableOfflineQueue: true; pingInterval: number };
  socketTls:
    | {
        tls: true;
        rejectUnauthorized: boolean;
        ca?: string;
        cert?: string;
        key?: string;
        passphrase?: string;
        servername?: string;
      }
    | undefined;
  logger: Logger;
}): Promise<ReturnType<typeof createSentinel>> {
  let attempt = 0;
  for (;;) {
    const client = createSentinel({
      name: input.sentinel.masterName?.trim() ?? '',
      sentinelRootNodes: parseRedisSentinelNodes(input.sentinel.nodes ?? ''),
      nodeClientOptions: {
        ...input.clientDefaults,
        ...input.auth,
        socket: { connectTimeout: CONNECT_TIMEOUT_MS, ...(input.socketTls ?? {}) },
      },
      sentinelClientOptions: {
        socket: { connectTimeout: CONNECT_TIMEOUT_MS, ...(input.socketTls ?? {}) },
        ...(input.sentinel.username ? { username: input.sentinel.username } : {}),
        ...(input.sentinel.password ? { password: input.sentinel.password } : {}),
      },
    });
    // Without an 'error' listener node-redis crashes the process on emit.
    client.on('error', (error: Error) => {
      input.logger.error('[Redis] Client error', extractErrorLogFields(error));
    });
    try {
      await client.connect();
      return client;
    } catch (error) {
      attempt += 1;
      try {
        await client.close();
      } catch {
        // ignore — may never have opened
      }
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('WRONGPASS') || message.includes('NOAUTH')) {
        throw new Error(`[Redis] Sentinel connect failed: ${message}`, { cause: error });
      }
      input.logger.error('[Redis] Sentinel connect failed, rebuilding and retrying', {
        attempt,
        ...extractErrorLogFields(error),
      });
      await sleep(Math.min(SENTINEL_RETRY_BASE_MS * 2 ** attempt, SENTINEL_RETRY_MAX_MS));
    }
  }
}

export async function connectRedis(input: {
  /** Preferred when set (may include userinfo). Env: `REDIS_URL`. */
  url: string | undefined;
  /** Used when `url` / Sentinel are unset. Env: `REDIS_HOST`. */
  host: string | undefined;
  /** Host mode only. Defaults to 6379. */
  port: number | undefined;
  /** Host / Sentinel mode only. Defaults to 0. */
  database: number | undefined;
  username: string | undefined;
  password: string | undefined;
  logger: Logger;
  sentinel:
    | {
        enabled: boolean | undefined;
        nodes: string | undefined;
        masterName: string | undefined;
        username: string | undefined;
        password: string | undefined;
      }
    | undefined;
  tls: RedisTlsInput | undefined;
}): Promise<RedisPeerClient> {
  input.logger.info('Connecting to Redis');

  const socketTls = buildTlsSocketOptions(input.tls);
  const auth = {
    database: input.database ?? DEFAULT_REDIS_DB,
    ...(input.username ? { username: input.username } : {}),
    ...(input.password ? { password: input.password } : {}),
  };
  const clientDefaults = {
    disableOfflineQueue: true,
    pingInterval: PING_INTERVAL_MS,
  } as const;
  const url = input.url?.trim();

  let client: RedisPeerClient;
  if (isRedisSentinelConfigured(input.sentinel) && input.sentinel) {
    // createSentinel()'s return is not assignable to RedisSentinelType under exactOptionalPropertyTypes
    // @ts-expect-error TS2375
    client = await connectSentinelWithRetry({
      sentinel: input.sentinel,
      auth,
      clientDefaults,
      socketTls,
      logger: input.logger,
    });
  } else if (url) {
    client = createClient({
      url,
      ...clientDefaults,
      socket: { connectTimeout: CONNECT_TIMEOUT_MS, ...(socketTls ?? {}) },
    });
    // Without an 'error' listener node-redis crashes the process on emit.
    client.on('error', (error: Error) => {
      input.logger.error('[Redis] Client error', extractErrorLogFields(error));
    });
    await client.connect();
  } else if (input.host?.trim()) {
    client = createClient({
      ...clientDefaults,
      ...auth,
      socket: {
        host: input.host.trim(),
        port: input.port ?? DEFAULT_REDIS_PORT,
        connectTimeout: CONNECT_TIMEOUT_MS,
        ...(socketTls ?? {}),
      },
    });
    // Without an 'error' listener node-redis crashes the process on emit.
    client.on('error', (error: Error) => {
      input.logger.error('[Redis] Client error', extractErrorLogFields(error));
    });
    await client.connect();
  } else {
    throw new Error(
      '[Redis] No connection configured: set REDIS_URL, REDIS_HOST, or Redis Sentinel ' +
        '(REDIS_SENTINEL_ENABLED with nodes and master name).',
    );
  }

  input.logger.info('Connected to Redis');
  return client;
}
