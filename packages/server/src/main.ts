/**
 * Server entry point: validates config, migrates Postgres, wires DB stores
 * and starts the HTTP server. Any config, migration, or store error aborts startup.
 * SQLite migrations are packaged under dist/ but are not run at startup.
 * Single-binary mode uses SQLite + in-memory event streams; multi-replica
 * uses Postgres + Redis. Any config, migration, or store error aborts startup.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { serve } from '@hono/node-server';
import type { ISessionStore, TurnStreamingEvent } from '@truefoundry/utils-core/agent-session';
import type { IOAuthTokenStore } from '@truefoundry/utils-core/core';
import type { RedisClientType } from 'redis';
import winston from 'winston';

import type { IMcpServerStore } from './db/mcpServerStore';
import type { IModelProviderStore } from './db/modelProviderStore';
import type { ISandboxProviderStore } from './db/sandboxProviderStore';
import type { ISkillStore } from './db/skillStore';

try {
  const [
    { createServerApp },
    { mountFrontend },
    { default: configuration },
    { Sessions, CancellationReason },
    { ActiveTurnRegistry },
    { createServerSandboxProvider },
    { connectRedis },
    { RequestReplyExecutor, RequestReplyRouter },
    { EventSubscriptionRegistry },
    { ModelCatalog },
    { McpCatalog },
    { SkillCatalog },
    { SandboxCatalog },
  ] = await Promise.all([
    import('./app'),
    import('./frontend'),
    import('./config'),
    import('@truefoundry/utils-core/agent-session'),
    import('./runtime/activeTurns'),
    import('./runtime/sandboxFactory'),
    import('./runtime/redis'),
    import('@truefoundry/utils-core/request-reply'),
    import('./runtime/event-subscription'),
    import('./catalog/ModelCatalog'),
    import('./catalog/McpCatalog'),
    import('./catalog/SkillCatalog'),
    import('./catalog/SandboxCatalog'),
  ]);

  // Console logger shared by the server runtime (harness components require one).
  const logger = winston.createLogger({
    level: process.env['LOG_LEVEL'] ?? 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [new winston.transports.Console()],
  });

  let sessionStore: ISessionStore;
  let modelProviderStore: IModelProviderStore;
  let mcpServerStore: IMcpServerStore;
  let tokenStore: IOAuthTokenStore;
  let skillStore: ISkillStore;
  let sandboxProviderStore: ISandboxProviderStore;
  let destroyDb: () => Promise<void>;

  if (configuration.SINGLE_BINARY) {
    const sqlitePath = configuration.SQLITE_PATH;
    if (sqlitePath === undefined) {
      throw new Error('SINGLE_BINARY=true requires SQLITE_PATH to be resolved');
    }
    await mkdir(path.dirname(sqlitePath), { recursive: true });
    const [{ createSqliteDb }, { migrateSqliteToLatest }, sqliteStores] = await Promise.all([
      import('./db/sqlite/client'),
      import('./db/migrateSqlite'),
      Promise.all([
        import('./db/sqlite/session-store/SqliteSessionStore'),
        import('./db/sqlite/model-provider-store/SqliteModelProviderStore'),
        import('./db/sqlite/mcp-server-store/SqliteMcpServerStore'),
        import('./db/sqlite/token-store/SqliteOAuthTokenStore'),
        import('./db/sqlite/skill-store/SqliteSkillStore'),
        import('./db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore'),
      ]),
    ]);
    const [
      { SqliteSessionStore },
      { SqliteModelProviderStore },
      { SqliteMcpServerStore },
      { SqliteOAuthTokenStore },
      { SqliteSkillStore },
      { SqliteSandboxProviderStore },
    ] = sqliteStores;

    const db = createSqliteDb(sqlitePath);
    await migrateSqliteToLatest(db);
    logger.info(`Single-binary mode: SQLite at ${sqlitePath}`);

    sessionStore = new SqliteSessionStore(db);
    modelProviderStore = new SqliteModelProviderStore(db);
    mcpServerStore = new SqliteMcpServerStore(db);
    tokenStore = new SqliteOAuthTokenStore(db);
    skillStore = new SqliteSkillStore(db);
    sandboxProviderStore = new SqliteSandboxProviderStore(db);
    destroyDb = () => db.destroy();
  } else {
    const databaseUrl = configuration.DATABASE_URL;
    if (databaseUrl === undefined) {
      throw new Error('SINGLE_BINARY=false requires POSTGRES_* to build DATABASE_URL');
    }
    const [{ createDb }, { migrateToLatest }, postgresStores] = await Promise.all([
      import('./db/postgres/client'),
      import('./db/migratePostgres'),
      Promise.all([
        import('./db/postgres/session-store/PostgresSessionStore'),
        import('./db/postgres/model-provider-store/PostgresModelProviderStore'),
        import('./db/postgres/mcp-server-store/PostgresMcpServerStore'),
        import('./db/postgres/token-store/PostgresOAuthTokenStore'),
        import('./db/postgres/skill-store/PostgresSkillStore'),
        import('./db/postgres/sandbox-provider-store/PostgresSandboxProviderStore'),
      ]),
    ]);
    const [
      { PostgresSessionStore },
      { PostgresModelProviderStore },
      { PostgresMcpServerStore },
      { PostgresOAuthTokenStore },
      { PostgresSkillStore },
      { PostgresSandboxProviderStore },
    ] = postgresStores;

    const db = createDb({
      connectionString: databaseUrl,
      poolMax: configuration.DATABASE_POOL_MAX,
      statementTimeoutMs: configuration.POSTGRES_STATEMENT_TIMEOUT_MS,
      idleInTransactionSessionTimeoutMs: configuration.POSTGRES_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS,
    });
    await migrateToLatest(db);

    sessionStore = new PostgresSessionStore(db);
    modelProviderStore = new PostgresModelProviderStore(db);
    mcpServerStore = new PostgresMcpServerStore(db);
    tokenStore = new PostgresOAuthTokenStore(db);
    skillStore = new PostgresSkillStore(db);
    sandboxProviderStore = new PostgresSandboxProviderStore(db);
    destroyDb = () => db.destroy();
  }

  // Throws on malformed SANDBOX_SETTINGS; undefined when sandbox is not configured.
  const sandboxProvider = createServerSandboxProvider({ logger });
  const activeTurns = new ActiveTurnRegistry();

  let redis: RedisClientType | undefined;
  if (configuration.REDIS_URL === undefined) {
    logger.info('Single-binary mode: executor peering disabled and Redis unused');
  } else {
    logger.info(`Executor id: ${configuration.EXECUTOR_ID}`);
    redis = await connectRedis({ url: configuration.REDIS_URL, logger });
  }
  const requestReplyRouter = new RequestReplyRouter();
  const eventSubscriptions = new EventSubscriptionRegistry<TurnStreamingEvent>(redis);

  const app = createServerApp({
    modelCatalog: ModelCatalog.load(),
    mcpCatalog: McpCatalog.load(),
    skillCatalog: SkillCatalog.load(),
    sandboxCatalog: SandboxCatalog.load(),
    modelProviderStore,
    mcpServerStore,
    tokenStore,
    skillStore,
    sandboxProviderStore,
    sessionStore,
    sessions: new Sessions({ sessionStore }),
    activeTurns,
    ...(sandboxProvider ? { sandboxProvider } : {}),
    redis,
    requestReplyRouter,
    eventSubscriptions,
    logger,
  });

  if (mountFrontend(app, configuration.FRONTEND_DIR)) {
    logger.info(`Serving frontend from ${configuration.FRONTEND_DIR}`);
  } else {
    logger.warn(
      `No frontend build at ${configuration.FRONTEND_DIR}: serving the API only. ` +
        'Run `pnpm --filter frontend build` to serve the UI from here, or `pnpm dev:frontend` for UI work.',
    );
  }

  // After createServerApp so every request-reply route is registered before
  // the executor starts consuming messages. The executor needs a dedicated
  // subscriber connection (a subscribed client cannot issue normal commands);
  // this process owns its lifecycle. Connect before init() so init() awaits
  // the initial subscribe + heartbeat — the replica is reachable for peering
  // before the HTTP server starts.
  let requestReplySubscriber: RedisClientType | undefined;
  let requestReplyExecutor: InstanceType<typeof RequestReplyExecutor> | undefined;
  if (redis) {
    requestReplySubscriber = redis.duplicate();
    requestReplySubscriber.on('error', (error: Error) => {
      logger.error('[RedisSubscriber] Client error', { error: error.message });
    });
    await requestReplySubscriber.connect();
    requestReplyExecutor = new RequestReplyExecutor({
      executorId: configuration.EXECUTOR_ID,
      redis,
      subscriberClient: requestReplySubscriber,
      requestHandler: requestReplyRouter.createRequestHandler(),
      logger,
      options: {
        heartbeatIntervalMs: configuration.REDIS_REQUEST_REPLY_HEARTBEAT_INTERVAL_MS,
        replyTtlMs: configuration.REDIS_REQUEST_REPLY_REPLY_TTL_MS,
      },
    });
    await requestReplyExecutor.init();
  }

  const server = serve({ fetch: app.fetch, port: configuration.PORT }, info => {
    console.log(`Agent server listening on http://localhost:${String(info.port)} (docs at /api/v1/docs)`);
  });

  server.on('error', (error: unknown) => {
    console.error('Failed to start server:', error instanceof Error ? error.message : error);
    process.exit(1);
  });

  // Graceful drain is the safe default for built and direct execution.
  // Development watch mode opts out so tsx can restart without waiting for a drain.
  if (process.env['NODE_ENV'] !== 'development') {
    let shuttingDown = false;
    const shutdown = async (signal: NodeJS.Signals) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info(`Received ${signal}, draining connections before shutdown`);

      // Arm at the start of each shutdown; unref so this timer alone cannot keep the process alive.
      setTimeout(() => {
        logger.warn(`Drain timed out after ${String(configuration.GRACEFUL_TIMEOUT_SECONDS)}s, exiting`);
        process.exit(1);
      }, configuration.GRACEFUL_TIMEOUT_SECONDS * 1000).unref();

      const closed = new Promise<void>(resolve => {
        server.close(() => {
          resolve();
        });
      });

      // Sets the registry's shutdown reason immediately so late track() (in-flight create-turn still
      // inside session.createTurn) aborts as Abandoned; then drains the registry. await
      // closed covers the gap where the registry is empty before that late track().
      await activeTurns.shutdownAndWait(CancellationReason.Abandoned);
      await closed;
      // Stop serving peer requests (waits for in-flight replies), then close
      // the clients this process owns: the subscriber duplicate and the primary.
      await requestReplyExecutor?.drain();
      await requestReplySubscriber?.close().catch((error: unknown) => {
        logger.warn('[Redis] Error closing subscriber client during shutdown', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
      await redis?.close().catch((error: unknown) => {
        logger.warn('[Redis] Error closing client during shutdown', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
      await destroyDb();
      process.exit(0);
    };
    process.on('SIGTERM', signal => {
      void shutdown(signal);
    });
    process.on('SIGINT', signal => {
      void shutdown(signal);
    });
  }
} catch (error) {
  console.error('Failed to start server:', error instanceof Error ? error.message : error);
  process.exit(1);
}
