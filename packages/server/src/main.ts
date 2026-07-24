/**
 * Server entry point: validates config, loads the YAML stores, wires the
 * in-memory session runtime and starts the HTTP server. Any config or store
 * error aborts startup.
 */
import { serve } from '@hono/node-server';
import winston from 'winston';

try {
  const [
    { createServerApp },
    { default: configuration },
    { ModelStore },
    { McpStore },
    { SkillStore },
    { Sessions, InMemorySessionStore },
    { ActiveTurnRegistry },
    { createServerSandboxFactory },
  ] = await Promise.all([
    import('./app'),
    import('./config'),
    import('./store/ModelStore'),
    import('./store/McpStore'),
    import('./store/SkillStore'),
    import('@truefoundry/utils/agent-session'),
    import('./runtime/activeTurns'),
    import('./runtime/sandboxFactory'),
  ]);

  // Console logger shared by the server runtime (harness components require one).
  const logger = winston.createLogger({
    level: process.env['LOG_LEVEL'] ?? 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [new winston.transports.Console()],
  });

  const sessionStore = new InMemorySessionStore();
  // Throws on malformed SANDBOX_SETTINGS; undefined when sandbox is not configured.
  const sandboxFactory = createServerSandboxFactory({ logger });
  const app = createServerApp({
    modelStore: ModelStore.load(),
    mcpStore: McpStore.load(),
    skillStore: SkillStore.load(),
    sessionStore,
    sessions: new Sessions({ sessionStore }),
    activeTurns: new ActiveTurnRegistry(),
    ...(sandboxFactory ? { sandboxFactory } : {}),
    logger,
  });

  const server = serve({ fetch: app.fetch, port: configuration.PORT }, info => {
    console.log(`Agent server listening on http://localhost:${String(info.port)} (docs at /docs)`);
  });

  server.on('error', error => {
    console.error('Failed to start server:', error instanceof Error ? error.message : error);
    process.exit(1);
  });

  // Graceful drain: stop accepting new connections, let in-flight requests
  // finish, then exit. Without this, Node (running as PID 1 in the container)
  // ignores SIGTERM and docker stop escalates to SIGKILL after its grace
  // period, killing requests mid-flight.
  const DRAIN_TIMEOUT_MS = 8_000;
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, draining connections before shutdown`);

    server.close(() => {
      process.exit(0);
    });
    // Keep-alive connections with no in-flight request would otherwise hold
    // the server open until the client closes them.
    if ('closeIdleConnections' in server) {
      server.closeIdleConnections();
    }

    // Force exit if draining outlasts the timeout (kept below Docker's
    // default 10s stop grace period so we exit on our own terms).
    setTimeout(() => {
      logger.warn(`Drain timed out after ${String(DRAIN_TIMEOUT_MS)}ms, exiting`);
      process.exit(1);
    }, DRAIN_TIMEOUT_MS).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
} catch (error) {
  console.error('Failed to start server:', error instanceof Error ? error.message : error);
  process.exit(1);
}
