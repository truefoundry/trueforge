/**
 * Server entry point: validates config, migrates Postgres, loads the YAML
 * stores, wires the Postgres session store and starts the HTTP server.
 * Any config, migration, or store error aborts startup.
 * SQLite migrations are packaged under dist/ but are not run at startup.
 */
import { serve } from '@hono/node-server';
import type { RedisClientType } from 'redis';
import winston from 'winston';

try {
  const [
    { createServerApp },
    { mountFrontend },
    { default: configuration },
    { createDb },
    { migrateToLatest },
    { ModelStore },
    { McpStore },
    { SkillStore },
    { Sessions, CancellationReason },
    { ActiveTurnRegistry },
    { createServerSandboxFactory },
    { connectRedis },
    { RequestReplyExecutor, RequestReplyRouter },
    { PostgresSessionStore },
    { ModelCatalog },
    { PostgresModelProviderStore },
  ] = await Promise.all([
    import('./app'),
    import('./frontend'),
    import('./config'),
    import('./db/postgres/client'),
    import('./db/migratePostgres'),
    import('./legacy-registry-store/ModelStore'),
    import('./legacy-registry-store/McpStore'),
    import('./legacy-registry-store/SkillStore'),
    import('@truefoundry/utils/agent-session'),
    import('./runtime/activeTurns'),
    import('./runtime/sandboxFactory'),
    import('./runtime/redis'),
    import('@truefoundry/utils/request-reply'),
    import('./db/postgres/session-store/PostgresSessionStore'),
    import('./catalog/ModelCatalog'),
    import('./db/postgres/model-provider-store/PostgresModelProviderStore'),
  ]);

  // Console logger shared by the server runtime (harness components require one).
  const logger = winston.createLogger({
    level: process.env['LOG_LEVEL'] ?? 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [new winston.transports.Console()],
  });

  const db = createDb(configuration.DATABASE_URL, configuration.DATABASE_POOL_MAX);
  await migrateToLatest(db);

  const sessionStore = new PostgresSessionStore(db);
  // Throws on malformed SANDBOX_SETTINGS; undefined when sandbox is not configured.
  const skillStore = SkillStore.load();
  const sandboxFactory = createServerSandboxFactory({ logger });
  const activeTurns = new ActiveTurnRegistry();

  let redis: RedisClientType | undefined;
  if (configuration.REDIS_URL === undefined) {
    logger.info('Single-binary mode: executor peering disabled and Redis unused');
  } else {
    logger.info(`Executor id: ${configuration.EXECUTOR_ID}`);
    redis = await connectRedis({ url: configuration.REDIS_URL, logger });
  }
  const requestReplyRouter = new RequestReplyRouter();

  const app = createServerApp({
    modelStore: ModelStore.load(),
    modelCatalog: ModelCatalog.load(),
    modelProviderStore: new PostgresModelProviderStore(db),
    mcpStore: McpStore.load(),
    skillStore,
    sessionStore,
    sessions: new Sessions({ sessionStore }),
    activeTurns,
    ...(sandboxFactory ? { sandboxFactory } : {}),
    redis,
    requestReplyRouter,
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
      await db.destroy();
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
