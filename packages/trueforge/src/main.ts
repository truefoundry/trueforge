/**
 * Server entry point: validates config, migrates the selected database, wires
 * stores, and starts the HTTP server. Any config, migration, or store error
 * aborts startup.
 *
 * `STANDALONE=true` (default): SQLite, no Redis. `STANDALONE=false`: Postgres + Redis.
 *
 * Config is validated at import time (`./config`). Runtime startup failures
 * (migrate, Redis, listen) are caught below and exit non-zero. SQLite vs
 * Postgres store modules stay dynamic so only the active engine is loaded.
 */
import { extractErrorLogFields } from '@truefoundry/trueforge-core/core';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  ensureLocalSandboxRootParent,
  prepareCodeModeSocketParent,
  removeCodeModeSocketParent,
} from './sandbox/localLifecycle';
import { setCachedLocalSandboxSupport } from './sandbox/localRuntime';

let configuration: typeof import('./config').default;
let isOidcConfigured: typeof import('./config').isOidcConfigured;
let isTrueFoundryModeEnabled: typeof import('./config').isTrueFoundryModeEnabled;
let getTrueForgeMode: typeof import('./config').getTrueForgeMode;
let TrueForgeMode: typeof import('./config').TrueForgeMode;

try {
  ({
    default: configuration,
    isOidcConfigured,
    isTrueFoundryModeEnabled,
    getTrueForgeMode,
    TrueForgeMode,
  } = await import('./config'));
} catch (error) {
  console.error(
    'Failed to start server: Failed to load configuration:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
}

import { serve } from '@hono/node-server';
import {
  CancellationReason,
  Sessions,
  type ISessionStore,
  type TurnStreamingEvent,
} from '@truefoundry/trueforge-core/agent-session';
import { RequestReplyExecutor, RequestReplyRouter } from '@truefoundry/trueforge-core/request-reply';
import type { Kysely, Transaction } from 'kysely';
import type { RedisClientType } from 'redis';
import type { Logger } from 'winston';

import { createServerApp } from './app';
import { TrueForgeAuthorizer, type Authorizer } from './auth/authorizer';
import { createAuthenticator } from './auth/createAuthenticator';
import { resolveRequestContext } from './auth/identity';
import { initOidc } from './auth/oidc';
import { McpCatalog } from './catalog/McpCatalog';
import { ModelCatalog } from './catalog/ModelCatalog';
import { SandboxCatalog } from './catalog/SandboxCatalog';
import { SkillCatalog } from './catalog/SkillCatalog';
import { type DistributedServerConfiguration } from './config';
import { createController } from './controller';
import type { IAgentStore } from './db/agentStore';
import type { IMcpServerStore, IMcpServerWithAuthStore } from './db/mcpServerStore';
import { McpServerWithAuthStore } from './db/McpServerWithAuthStore';
import type { IModelProviderStore } from './db/modelProviderStore';
import type { PostgresAgentStore } from './db/postgres/agent-store/PostgresAgentStore';
import type { Database as PostgresDatabase } from './db/postgres/types';
import type { ISandboxProviderStore } from './db/sandboxProviderStore';
import type { IScheduleStore } from './db/scheduleStore';
import type { ISessionMetricsStore } from './db/sessionMetricsStore';
import type { ISkillStore } from './db/skillStore';
import type { Database as SqliteDatabase } from './db/sqlite/types';
import type { WithTransaction } from './db/transaction';
import { mountFrontend } from './frontend';
import { serverTlsServeOptions } from './http/tls';
import { createServerLogger, shouldColorize } from './logger';
import type { IOAuthTokenStore } from './mcp/auth/types';
import { PACKAGE_VERSION } from './packageVersion';
import { ActiveTurnRegistry } from './runtime/activeTurns';
import { EventSubscriptionRegistry } from './runtime/event-subscription';
import { printStandaloneStartupBanner } from './startupBanner';
import { parsePerServerMcpHeaders, X_TFG_MCP_HEADERS } from './truefoundry/perServerMcpHeaders';
import { TrueFoundryAgentStore } from './truefoundry/TrueFoundryAgentStore';
import { TrueFoundryAuthorizer } from './truefoundry/TrueFoundryAuthorizer';
import { TrueFoundryMcpServerStore } from './truefoundry/TrueFoundryMcpServerStore';
import { TrueFoundryModelProviderStore } from './truefoundry/TrueFoundryModelProviderStore';
import { TrueFoundrySandboxProviderStore } from './truefoundry/TrueFoundrySandboxProviderStore';
import { TrueFoundryServiceFoundryServerClient } from './truefoundry/TrueFoundryServiceFoundryServerClient';

/** Persistence + optional Redis wired for the selected topology. */
interface ServerPersistence<TTransaction> {
  sessionStore: ISessionStore;
  sessionMetricsStore: ISessionMetricsStore;
  resolveModelProviderStore: (c?: Context) => IModelProviderStore<TTransaction>;
  resolveMcpServerStore: (c?: Context) => IMcpServerWithAuthStore<TTransaction>;
  resolveAgentStore: (c?: Context) => IAgentStore<TTransaction>;
  resolveSandboxProviderStore: (c?: Context) => ISandboxProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  tokenStore: IOAuthTokenStore<TTransaction>;
  skillStore: ISkillStore<TTransaction>;
  scheduleStore: IScheduleStore<TTransaction>;
  destroyDb: () => Promise<void>;
  redis: RedisClientType | undefined;
}

function requireRequestCredentialToken(c: Context): string {
  const credential = resolveRequestContext(c).user_credential;
  if (credential === null) {
    throw new HTTPException(401, {
      message: 'Authentication token required to list or call TrueFoundry models, MCP servers, agents, and sandbox',
    });
  }
  return credential;
}

/**
 * Shared ServiceFoundry HTTP client for TrueFoundry-mode store resolvers (models, MCP, agents).
 * Undefined when TrueFoundry mode is off — resolvers then use persistence only.
 */
function createServiceFoundryServerClient(logger: Logger): TrueFoundryServiceFoundryServerClient | undefined {
  if (!isTrueFoundryModeEnabled(configuration)) {
    return undefined;
  }
  return new TrueFoundryServiceFoundryServerClient({
    serviceFoundryServerUrl: configuration.TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL,
    logger,
    httpTimeoutMs: configuration.TRUEFOUNDRY_SERVICEFOUNDRY_HTTP_TIMEOUT_MS,
    httpAgentTimeoutMs: configuration.TRUEFOUNDRY_SERVICEFOUNDRY_HTTP_AGENT_TIMEOUT_MS,
    tls: { enabled: configuration.TRUEFOUNDRY_MTLS_ENABLED, dir: configuration.TRUEFOUNDRY_MTLS_CERTS_DIR },
  });
}

/**
 * Per-request model-provider store resolver. In TrueFoundry mode every request gets a token-bound
 * store over a shared (mTLS) ServiceFoundry client; otherwise the persistence store is reused as-is.
 */
function buildResolveModelProviderStore<TTransaction>(options: {
  persistenceStore: IModelProviderStore<TTransaction>;
  client: TrueFoundryServiceFoundryServerClient | undefined;
}): (c?: Context) => IModelProviderStore<TTransaction> {
  const { persistenceStore, client } = options;
  if (!client) {
    return () => persistenceStore;
  }
  // No request context (e.g. the scheduler) means no caller token, so TrueFoundry models are
  // unavailable there; fall back to the persistence store.
  return c =>
    c
      ? new TrueFoundryModelProviderStore<TTransaction>({ client, accessToken: requireRequestCredentialToken(c) })
      : persistenceStore;
}

/**
 * Per-request MCP store resolver. Local mode wraps DB persistence with
 * {@link McpServerWithAuthStore}. TrueFoundry mode returns a token-bound
 * {@link TrueFoundryMcpServerStore} (implements auth UX stubs); without request
 * context (scheduler / OAuth callback) falls back to the local with-auth store.
 */
function buildResolveMcpServerStore<TTransaction>(options: {
  persistenceStore: IMcpServerStore<TTransaction>;
  tokenStore: IOAuthTokenStore<TTransaction>;
  client: TrueFoundryServiceFoundryServerClient | undefined;
}): (c?: Context) => IMcpServerWithAuthStore<TTransaction> {
  const withAuthPersistence = new McpServerWithAuthStore<TTransaction>({
    store: options.persistenceStore,
    tokenStore: options.tokenStore,
    clientName: configuration.MCP_DCR_OAUTH_CLIENT_NAME,
  });
  const { client } = options;
  if (!client) {
    return () => withAuthPersistence;
  }
  return c => {
    if (!c) {
      return withAuthPersistence;
    }
    const requestContext = resolveRequestContext(c);
    const rawPerServerHeaders = c.req.header(X_TFG_MCP_HEADERS);
    return new TrueFoundryMcpServerStore<TTransaction>({
      client,
      accessToken: requireRequestCredentialToken(c),
      subject: requestContext.subject,
      perServerHeaders: rawPerServerHeaders ? parsePerServerMcpHeaders(rawPerServerHeaders) : {},
    });
  };
}

/**
 * Per-request agent store resolver. In TrueFoundry mode every request gets a token-bound
 * decorator over DB persistence; otherwise the persistence store is reused as-is.
 */
function buildResolveAgentStore(options: {
  persistenceStore: PostgresAgentStore;
  client: TrueFoundryServiceFoundryServerClient | undefined;
  db: Kysely<PostgresDatabase>;
}): (c?: Context) => IAgentStore<Transaction<PostgresDatabase>> {
  const { persistenceStore, client, db } = options;
  if (!client) {
    return () => persistenceStore;
  }
  // No request context (e.g. the scheduler) means no caller token, so fall back to persistence.
  return c =>
    c
      ? new TrueFoundryAgentStore({
          inner: persistenceStore,
          client,
          accessToken: requireRequestCredentialToken(c),
          db,
        })
      : persistenceStore;
}

/**
 * Per-request sandbox-provider store resolver. In TrueFoundry mode every request gets a
 * token-bound env/settings-server store; otherwise the persistence store is reused as-is.
 */
function buildResolveSandboxProviderStore<TTransaction>(options: {
  persistenceStore: ISandboxProviderStore<TTransaction>;
}): (c?: Context) => ISandboxProviderStore<TTransaction> {
  const { persistenceStore } = options;
  if (!isTrueFoundryModeEnabled(configuration)) {
    return () => persistenceStore;
  }
  // No request context (e.g. the scheduler) means no caller token for the settings server.
  return c =>
    c
      ? new TrueFoundrySandboxProviderStore<TTransaction>({
          accessToken: requireRequestCredentialToken(c),
        })
      : persistenceStore;
}

/** SQLite stores; Redis unused (executor peering disabled). */
async function createStandalonePersistence(options: {
  sqlitePath: string;
  logger: Logger;
}): Promise<ServerPersistence<Transaction<SqliteDatabase>>> {
  const { sqlitePath, logger } = options;
  await mkdir(path.dirname(sqlitePath), { recursive: true });
  const [{ createSqliteDb }, { migrateSqliteToLatest }, sqliteStores] = await Promise.all([
    import('./db/sqlite/client'),
    import('./db/migrateSqlite'),
    Promise.all([
      import('./db/sqlite/session-store/SqliteSessionStore'),
      import('./db/sqlite/session-metrics/SqliteSessionMetricsStore'),
      import('./db/sqlite/model-provider-store/SqliteModelProviderStore'),
      import('./db/sqlite/mcp-server-store/SqliteMcpServerStore'),
      import('./db/sqlite/token-store/SqliteOAuthTokenStore'),
      import('./db/sqlite/skill-store/SqliteSkillStore'),
      import('./db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore'),
      import('./db/sqlite/agent-store/SqliteAgentStore'),
      import('./db/sqlite/schedule-store/SqliteScheduleStore'),
    ]),
  ]);
  const [
    { SqliteSessionStore },
    { SqliteSessionMetricsStore },
    { SqliteModelProviderStore },
    { SqliteMcpServerStore },
    { SqliteOAuthTokenStore },
    { SqliteSkillStore },
    { SqliteSandboxProviderStore },
    { SqliteAgentStore },
    { SqliteScheduleStore },
  ] = sqliteStores;

  const db = createSqliteDb(sqlitePath);
  await migrateSqliteToLatest(db);
  logger.info(`Standalone mode: sqlite at ${sqlitePath}`);
  logger.info('Standalone mode: executor peering disabled and Redis unused');

  const tokenStore = new SqliteOAuthTokenStore(db);
  const agentStore = new SqliteAgentStore(db);
  return {
    sessionStore: new SqliteSessionStore(db),
    sessionMetricsStore: new SqliteSessionMetricsStore(db),
    resolveModelProviderStore: buildResolveModelProviderStore({
      persistenceStore: new SqliteModelProviderStore(db),
      client: undefined,
    }),
    resolveMcpServerStore: buildResolveMcpServerStore({
      persistenceStore: new SqliteMcpServerStore(db),
      tokenStore,
      client: undefined,
    }),
    resolveAgentStore: () => agentStore,
    resolveSandboxProviderStore: buildResolveSandboxProviderStore({
      persistenceStore: new SqliteSandboxProviderStore(db),
    }),
    withTransaction: callback => db.transaction().execute(callback),
    tokenStore,
    skillStore: new SqliteSkillStore(db),
    scheduleStore: new SqliteScheduleStore(db),
    destroyDb: () => db.destroy(),
    redis: undefined,
  };
}

/** Postgres stores + Redis for executor peering. */
async function createDistributedPersistence(options: {
  configuration: DistributedServerConfiguration;
  logger: Logger;
}): Promise<ServerPersistence<Transaction<PostgresDatabase>>> {
  const { configuration, logger } = options;
  const {
    DATABASE_URL: databaseUrl,
    DATABASE_POOL_MAX: databasePoolMax,
    POSTGRES_STATEMENT_TIMEOUT_MS: statementTimeoutMs,
    POSTGRES_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS: idleInTransactionSessionTimeoutMs,
    REDIS_URL: redisUrl,
    EXECUTOR_ID: executorId,
  } = configuration;

  const [{ createDb }, { migrateToLatest }, { connectRedis }, postgresStores] = await Promise.all([
    import('./db/postgres/client'),
    import('./db/migratePostgres'),
    import('./runtime/redis'),
    Promise.all([
      import('./db/postgres/session-store/PostgresSessionStore'),
      import('./db/postgres/session-metrics/PostgresSessionMetricsStore'),
      import('./db/postgres/model-provider-store/PostgresModelProviderStore'),
      import('./db/postgres/mcp-server-store/PostgresMcpServerStore'),
      import('./db/postgres/token-store/PostgresOAuthTokenStore'),
      import('./db/postgres/skill-store/PostgresSkillStore'),
      import('./db/postgres/sandbox-provider-store/PostgresSandboxProviderStore'),
      import('./db/postgres/agent-store/PostgresAgentStore'),
      import('./db/postgres/schedule-store/PostgresScheduleStore'),
    ]),
  ]);
  const [
    { PostgresSessionStore },
    { PostgresSessionMetricsStore },
    { PostgresModelProviderStore },
    { PostgresMcpServerStore },
    { PostgresOAuthTokenStore },
    { PostgresSkillStore },
    { PostgresSandboxProviderStore },
    { PostgresAgentStore },
    { PostgresScheduleStore },
  ] = postgresStores;

  const db = createDb({
    connectionString: databaseUrl,
    poolMax: databasePoolMax,
    statementTimeoutMs,
    idleInTransactionSessionTimeoutMs,
  });
  await migrateToLatest(db);
  logger.info('Distributed mode: postgres');
  logger.info(`Executor id: ${executorId}`);

  const tokenStore = new PostgresOAuthTokenStore(db);
  const agentStore = new PostgresAgentStore(db);
  const serviceFoundryClient = createServiceFoundryServerClient(logger);
  return {
    sessionStore: new PostgresSessionStore(db),
    sessionMetricsStore: new PostgresSessionMetricsStore(db),
    resolveModelProviderStore: buildResolveModelProviderStore({
      persistenceStore: new PostgresModelProviderStore(db),
      client: serviceFoundryClient,
    }),
    resolveMcpServerStore: buildResolveMcpServerStore({
      persistenceStore: new PostgresMcpServerStore(db),
      tokenStore,
      client: serviceFoundryClient,
    }),
    resolveAgentStore: buildResolveAgentStore({
      persistenceStore: agentStore,
      client: serviceFoundryClient,
      db,
    }),
    resolveSandboxProviderStore: buildResolveSandboxProviderStore({
      persistenceStore: new PostgresSandboxProviderStore(db),
    }),
    withTransaction: callback => db.transaction().execute(callback),
    tokenStore,
    skillStore: new PostgresSkillStore(db),
    scheduleStore: new PostgresScheduleStore(db),
    destroyDb: () => db.destroy(),
    redis: await connectRedis({ url: redisUrl, logger }),
  };
}

/** Keeps `TTransaction` concrete when wiring a single persistence topology into the app. */
async function createServerRuntime<TTransaction>(persistence: ServerPersistence<TTransaction>, logger: Logger) {
  const {
    sessionStore,
    sessionMetricsStore,
    resolveModelProviderStore,
    resolveMcpServerStore,
    resolveAgentStore,
    resolveSandboxProviderStore,
    withTransaction,
    tokenStore,
    skillStore,
    scheduleStore,
    destroyDb,
    redis,
  } = persistence;

  const activeTurns = new ActiveTurnRegistry();
  const requestReplyRouter = new RequestReplyRouter();
  const eventSubscriptions = new EventSubscriptionRegistry<TurnStreamingEvent>(redis);

  const oidc = isOidcConfigured(configuration) ? configuration.OIDC : undefined;
  if (oidc) {
    logger.info('Auth is enabled', { issuer: oidc.OIDC_ISSUER_URL });
  } else {
    logger.warn('Auth is disabled; browser login is off');
  }
  const oidcClient = await initOidc(oidc);

  let authenticator;
  let authorizer: Authorizer;
  const mode = getTrueForgeMode(configuration);
  if (mode === TrueForgeMode.TrueFoundry) {
    if (!isTrueFoundryModeEnabled(configuration)) {
      throw new Error('TrueFoundry mode requires TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL');
    }
    const trueFoundryClient = new TrueFoundryServiceFoundryServerClient({
      serviceFoundryServerUrl: configuration.TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL,
      logger,
      httpTimeoutMs: configuration.TRUEFOUNDRY_SERVICEFOUNDRY_HTTP_TIMEOUT_MS,
      httpAgentTimeoutMs: configuration.TRUEFOUNDRY_SERVICEFOUNDRY_HTTP_AGENT_TIMEOUT_MS,
      tls: { enabled: configuration.TRUEFOUNDRY_MTLS_ENABLED, dir: configuration.TRUEFOUNDRY_MTLS_CERTS_DIR },
    });
    authenticator = createAuthenticator({
      mode: TrueForgeMode.TrueFoundry,
      trueFoundryClient,
    });
    authorizer = new TrueFoundryAuthorizer(trueFoundryClient);
  } else if (mode === TrueForgeMode.Oidc) {
    authenticator = createAuthenticator({ mode: TrueForgeMode.Oidc });
    authorizer = new TrueForgeAuthorizer();
  } else {
    authenticator = createAuthenticator({ mode: TrueForgeMode.Standalone });
    authorizer = new TrueForgeAuthorizer();
  }

  // Standalone is one process, so it owns the control loops too.
  const controller = configuration.STANDALONE
    ? createController({
        scheduleStore,
        withTransaction,
        logger,
        baseUrl: `http://localhost:${String(configuration.PORT)}`,
      })
    : undefined;

  const app = createServerApp({
    modelCatalog: ModelCatalog.load(),
    mcpCatalog: McpCatalog.load(),
    skillCatalog: SkillCatalog.load(),
    sandboxCatalog: SandboxCatalog.load(),
    resolveModelProviderStore,
    resolveMcpServerStore,
    resolveAgentStore,
    resolveSandboxProviderStore,
    withTransaction,
    tokenStore,
    skillStore,
    scheduleStore,
    sessionStore,
    sessionMetricsStore,
    sessions: new Sessions({ sessionStore }),
    activeTurns,
    redis,
    requestReplyRouter,
    eventSubscriptions,
    logger,
    oidcClient,
    authenticator,
    authorizer,
  });

  return { activeTurns, app, controller, destroyDb, redis, requestReplyRouter };
}

try {
  const logger = createServerLogger({
    level: configuration.LOG_LEVEL,
    standalone: configuration.STANDALONE,
    version: PACKAGE_VERSION,
  });

  if (configuration.STANDALONE) {
    printStandaloneStartupBanner({ version: PACKAGE_VERSION, color: shouldColorize() });
    await prepareCodeModeSocketParent({ path: configuration.CODE_MODE_SOCKET_PARENT, logger });
    await ensureLocalSandboxRootParent(configuration.LOCAL_SANDBOX_ROOT_PARENT);
    const { LocalSandboxProvider } = await import('./sandbox/local/provider/LocalSandboxProvider');
    const support = await LocalSandboxProvider.isSupported({
      codeModeSocketParentPath: configuration.CODE_MODE_SOCKET_PARENT,
    });
    setCachedLocalSandboxSupport(support);
    if (support.supported) {
      logger.info('Local sandbox fallback is available', {
        platform: support.platform,
        shell: support.shell,
        python: support.python,
      });
    } else {
      logger.warn('Local sandbox fallback is unavailable', {
        reason: support.reason,
        ...(support.platform === undefined ? {} : { platform: support.platform }),
        ...(support.attempts === undefined ? {} : { attempts: support.attempts }),
      });
    }
  } else {
    logger.info('TrueForge starting', { mode: 'distributed' });
  }

  const { activeTurns, app, controller, destroyDb, redis, requestReplyRouter } = configuration.STANDALONE
    ? await createServerRuntime(
        await createStandalonePersistence({ sqlitePath: configuration.SQLITE_PATH, logger }),
        logger,
      )
    : await createServerRuntime(await createDistributedPersistence({ configuration, logger }), logger);

  if (mountFrontend(app, configuration.FRONTEND_DIR)) {
    logger.info(`Serving frontend from ${configuration.FRONTEND_DIR}`);
  } else {
    logger.warn(
      `No frontend build at ${configuration.FRONTEND_DIR}: serving the API only. ` +
        'Run `pnpm --filter frontend build` (and copy via build:frontend-assets) to serve the UI, or `pnpm standalone:dev` / `pnpm dev` for Vite.',
    );
  }

  // After createServerApp so every request-reply route is registered before
  // the executor starts consuming messages. The executor needs a dedicated
  // subscriber connection (a subscribed client cannot issue normal commands);
  // this process owns its lifecycle. Connect before init() so init() awaits
  // the initial subscribe + heartbeat — the replica is reachable for peering
  // before the HTTP server starts.
  let requestReplySubscriber: RedisClientType | undefined;
  let requestReplyExecutor: RequestReplyExecutor | undefined;
  if (redis) {
    requestReplySubscriber = redis.duplicate();
    requestReplySubscriber.on('error', (error: Error) => {
      logger.error('[RedisSubscriber] Client error', extractErrorLogFields(error));
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

  const tlsServe = serverTlsServeOptions({
    enabled: !configuration.STANDALONE && configuration.TRUEFORGE_MTLS_ENABLED,
    dir: configuration.TRUEFORGE_MTLS_CERTS_DIR,
  });
  const server = serve(
    {
      fetch: app.fetch,
      port: configuration.PORT,
      hostname: configuration.HOST,
      ...(tlsServe ?? {}),
    },
    info => {
      const scheme = tlsServe !== undefined ? 'https' : 'http';
      logger.info(
        `Agent server listening on ${scheme}://${configuration.HOST}:${String(info.port)} (docs at /api/v1/docs)`,
      );
      // The controller calls this server over HTTP(S).
      controller?.start();
    },
  );

  server.on('error', (error: unknown) => {
    console.error('Failed to start server:', error instanceof Error ? error.message : error);
    process.exit(1);
  });

  // Graceful drain is the safe default for built and direct execution.
  // Development watch mode opts out so tsx can restart without waiting for a drain.
  if (configuration.NODE_ENV !== 'development') {
    let shuttingDown = false;
    const shutdown = async (signal: NodeJS.Signals) => {
      if (shuttingDown) {
        return;
      }
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

      // Stop the control loops before draining; anything they already started drains
      // with every other turn below.
      await controller?.stop();

      // Sets the registry's shutdown reason immediately so late track() (in-flight create-turn still
      // inside session.createTurn) aborts as Abandoned; then drains the registry. await
      // closed covers the gap where the registry is empty before that late track().
      await activeTurns.shutdownAndWait(CancellationReason.Abandoned);
      await closed;
      // Stop serving peer requests (waits for in-flight replies), then close
      // the clients this process owns: the subscriber duplicate and the primary.
      await requestReplyExecutor?.drain();
      await requestReplySubscriber?.close().catch((error: unknown) => {
        logger.warn('[Redis] Error closing subscriber client during shutdown', extractErrorLogFields(error));
      });
      await redis?.close().catch((error: unknown) => {
        logger.warn('[Redis] Error closing client during shutdown', extractErrorLogFields(error));
      });
      if (configuration.STANDALONE) {
        await removeCodeModeSocketParent(configuration.CODE_MODE_SOCKET_PARENT).catch((error: unknown) => {
          logger.warn('Error removing Code Mode socket parent during shutdown', extractErrorLogFields(error));
        });
      }
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
