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
const SENTINEL_RETRY_BASE_MS = 200;
const SENTINEL_RETRY_MAX_MS = 3_000;

/** Exactly one Redis transport, resolved at config load. */
export type RedisConnection =
  | { mode: 'url'; url: string }
  | {
      mode: 'host';
      host: string;
      port: number;
      database: number;
      username?: string;
      password?: string;
    }
  | {
      mode: 'sentinel';
      nodes: string;
      masterName: string;
      database: number;
      username?: string;
      password?: string;
      sentinelUsername?: string;
      sentinelPassword?: string;
    };

export type ConnectedRedis =
  | { mode: 'url'; client: RedisClientType }
  | { mode: 'host'; client: RedisClientType }
  | { mode: 'sentinel'; client: RedisPeerClient };

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

export interface RedisTlsInput {
  enabled: boolean | undefined;
  caCert: string | undefined;
  rejectUnauthorized: boolean | undefined;
  serverName: string | undefined;
  cert: string | undefined;
  key: string | undefined;
  keyPassphrase: string | undefined;
}

const PEM_MARKER = '-----BEGIN';

function resolvePemMaterial({ value, label }: { value: string; label: string }): string {
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
    ...(tls.caCert ? { ca: resolvePemMaterial({ value: tls.caCert, label: 'REDIS_TLS_CA_CERT' }) } : {}),
    ...(tls.cert ? { cert: resolvePemMaterial({ value: tls.cert, label: 'REDIS_TLS_CERT' }) } : {}),
    ...(tls.key ? { key: resolvePemMaterial({ value: tls.key, label: 'REDIS_TLS_KEY' }) } : {}),
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
  connection: Extract<RedisConnection, { mode: 'sentinel' }>;
  clientDefaults: { disableOfflineQueue: true; pingInterval: number };
  connectTimeoutMs: number;
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
  const { connection } = input;
  const auth = {
    database: connection.database,
    ...(connection.username ? { username: connection.username } : {}),
    ...(connection.password ? { password: connection.password } : {}),
  };
  let attempt = 0;
  for (;;) {
    const client = createSentinel({
      name: connection.masterName,
      sentinelRootNodes: parseRedisSentinelNodes(connection.nodes),
      nodeClientOptions: {
        ...input.clientDefaults,
        ...auth,
        socket: { connectTimeout: input.connectTimeoutMs, ...(input.socketTls ?? {}) },
      },
      sentinelClientOptions: {
        socket: { connectTimeout: input.connectTimeoutMs, ...(input.socketTls ?? {}) },
        ...(connection.sentinelUsername ? { username: connection.sentinelUsername } : {}),
        ...(connection.sentinelPassword ? { password: connection.sentinelPassword } : {}),
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

export interface ConnectRedisInput {
  connection: RedisConnection;
  tls: RedisTlsInput | undefined;
  logger: Logger;
  connectTimeoutMs: number;
  pingIntervalMs: number;
}

export async function connectRedis(input: ConnectRedisInput): Promise<ConnectedRedis> {
  input.logger.info('Connecting to Redis');

  const socketTls = buildTlsSocketOptions(input.tls);
  const clientDefaults = {
    disableOfflineQueue: true,
    pingInterval: input.pingIntervalMs,
  } as const;

  switch (input.connection.mode) {
    case 'sentinel': {
      // @ts-expect-error TS2375 createSentinel return not assignable under EOPT
      const client: RedisPeerClient = await connectSentinelWithRetry({
        connection: input.connection,
        clientDefaults,
        connectTimeoutMs: input.connectTimeoutMs,
        socketTls,
        logger: input.logger,
      });
      input.logger.info('Connected to Redis');
      return { mode: 'sentinel', client };
    }
    case 'url': {
      const created = createClient({
        url: input.connection.url,
        ...clientDefaults,
        socket: { connectTimeout: input.connectTimeoutMs, ...(socketTls ?? {}) },
      });
      // Without an 'error' listener node-redis crashes the process on emit.
      created.on('error', (error: Error) => {
        input.logger.error('[Redis] Client error', extractErrorLogFields(error));
      });
      await created.connect();
      input.logger.info('Connected to Redis');
      // @ts-expect-error TS2375 createClient return not assignable under EOPT
      const client: RedisClientType = created;
      return { mode: 'url', client };
    }
    case 'host': {
      const { host, port, database, username, password } = input.connection;
      const created = createClient({
        ...clientDefaults,
        database,
        ...(username ? { username } : {}),
        ...(password ? { password } : {}),
        socket: {
          host,
          port,
          connectTimeout: input.connectTimeoutMs,
          ...(socketTls ?? {}),
        },
      });
      // Without an 'error' listener node-redis crashes the process on emit.
      created.on('error', (error: Error) => {
        input.logger.error('[Redis] Client error', extractErrorLogFields(error));
      });
      await created.connect();
      input.logger.info('Connected to Redis');
      // @ts-expect-error TS2375 createClient return not assignable under EOPT
      const client: RedisClientType = created;
      return { mode: 'host', client };
    }
  }
}
