/**
 * Server entry point: validates config, migrates the database, loads the YAML
 * stores, wires the in-memory session runtime and starts the HTTP server.
 * Any config, migration, or store error aborts startup.
 */
import { serve } from '@hono/node-server';
import winston from 'winston';

try {
  const [
    { createServerApp },
    { default: configuration },
    { createDb },
    { migrateToLatest },
    { ModelStore },
    { McpStore },
    { SkillStore },
    { Sessions, InMemorySessionStore, CancellationReason },
    { ActiveTurnRegistry },
    { createServerSandboxFactory },
    { connectRedis },
    { standaloneSubscription },
    { RequestReplyExecutor, RequestReplyRouter },
  ] = await Promise.all([
    import('./app'),
    import('./config'),
    import('./db/client'),
    import('./db/migrate'),
    import('./store/ModelStore'),
    import('./store/McpStore'),
    import('./store/SkillStore'),
    import('@truefoundry/utils/agent-session'),
    import('./runtime/activeTurns'),
    import('./runtime/sandboxFactory'),
    import('./runtime/redis'),
    import('./runtime/subscription'),
    import('@truefoundry/utils/request-reply'),
  ]);

  // Console logger shared by the server runtime (harness components require one).
  const logger = winston.createLogger({
    level: process.env['LOG_LEVEL'] ?? 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [new winston.transports.Console()],
  });

  const db = createDb(configuration.DATABASE_URL, configuration.DATABASE_POOL_MAX);
  await migrateToLatest(db);

  const sessionStore = new InMemorySessionStore();
  // Throws on malformed SANDBOX_SETTINGS; undefined when sandbox is not configured.
  const skillStore = SkillStore.load();
  const sandboxFactory = createServerSandboxFactory({ logger });
  const activeTurns = new ActiveTurnRegistry();

  // Executor peering: this process's identity is embedded into turn ids so
  // any replica can route a cancel to the owner over Redis request-reply.
  logger.info(`Executor id: ${configuration.EXECUTOR_ID}`);
  const redis = await connectRedis({ url: configuration.REDIS_URL, logger });
  const requestReplyRouter = new RequestReplyRouter();

  const app = createServerApp({
    modelStore: ModelStore.load(),
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

  // After createServerApp so every request-reply route is registered before
  // the executor starts consuming messages.
  const requestReplyExecutor = new RequestReplyExecutor({
    executorId: configuration.EXECUTOR_ID,
    redis,
    requestHandler: requestReplyRouter.dispatchRoute.bind(requestReplyRouter),
    subscription: standaloneSubscription({ redis, logger }),
    logger,
    options: { heartbeatIntervalMs: configuration.REDIS_REQUEST_REPLY_HEARTBEAT_INTERVAL_MS },
  });
  await requestReplyExecutor.init();

  const server = serve({ fetch: app.fetch, port: configuration.PORT }, info => {
    console.log(`Agent server listening on http://localhost:${String(info.port)} (docs at /docs)`);
  });

  server.on('error', (error: unknown) => {
    console.error('Failed to start server:', error instanceof Error ? error.message : error);
    process.exit(1);
  });

  // Graceful drain: stop accepting new connections, cancel running turns as
  // abandoned, wait for them to persist terminal state, then exit. Without
  // this, Node (running as PID 1 in the container) ignores SIGTERM and docker
  // stop escalates to SIGKILL after its grace period.
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
    // the primary client the executor's subscriber was duplicated from.
    await requestReplyExecutor.drain();
    await redis.close().catch(() => undefined);
    await db.destroy();
    process.exit(0);
  };
  process.on('SIGTERM', signal => {
    void shutdown(signal);
  });
  process.on('SIGINT', signal => {
    void shutdown(signal);
  });
} catch (error) {
  console.error('Failed to start server:', error instanceof Error ? error.message : error);
  process.exit(1);
}
