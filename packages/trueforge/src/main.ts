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
let getTrueForgeAuthMode: typeof import('./config').getTrueForgeAuthMode;
let TrueForgeAuthMode: typeof import('./config').TrueForgeAuthMode;

try {
  ({
    default: configuration,
    isOidcConfigured,
    isTrueFoundryModeEnabled,
    getTrueForgeAuthMode,
    TrueForgeAuthMode,
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

import type { ResolveTurnStores } from './apis/turns';
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
import type { AgentRecord, IAgentStore } from './db/agentStore';
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
import { agentAccessToken, callerAccessToken, type ResolveAccessToken } from './truefoundry/accessToken';
import { parsePerServerMcpHeaders, X_TFG_MCP_HEADERS } from './truefoundry/perServerMcpHeaders';
import { TrueFoundryAgentStore } from './truefoundry/TrueFoundryAgentStore';
import { TrueFoundryAuthorizer } from './truefoundry/TrueFoundryAuthorizer';
import { TrueFoundryMcpServerStore } from './truefoundry/TrueFoundryMcpServerStore';
import { TrueFoundryModelProviderStore } from './truefoundry/TrueFoundryModelProviderStore';
import { TrueFoundryServiceFoundryServerClient } from './truefoundry/TrueFoundryServiceFoundryServerClient';

/** Persistence + optional Redis wired for the selected topology. */
interface ServerPersistence<TTransaction> {
  sessionStore: ISessionStore;
  sessionMetricsStore: ISessionMetricsStore;
  resolveModelProviderStore: (c: Context) => IModelProviderStore<TTransaction>;
  resolveMcpServerStore: (c?: Context) => IMcpServerWithAuthStore<TTransaction>;
  resolveTurnStores: ResolveTurnStores<TTransaction>;
  resolveAgentStore: (c: Context) => IAgentStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  tokenStore: IOAuthTokenStore<TTransaction>;
  skillStore: ISkillStore<TTransaction>;
  sandboxProviderStore: ISandboxProviderStore<TTransaction>;
  scheduleStore: IScheduleStore<TTransaction>;
  destroyDb: () => Promise<void>;
  redis: RedisClientType | undefined;
  /** One shared client for TrueFoundry store resolvers + auth; undefined when TrueFoundry mode is off. */
  serviceFoundryClient: TrueFoundryServiceFoundryServerClient | undefined;
}

/** Shared ServiceFoundry HTTP client when TrueFoundry mode is on; otherwise undefined. */
function createServiceFoundryServerClient(logger: Logger): TrueFoundryServiceFoundryServerClient | undefined {
  if (!isTrueFoundryModeEnabled(configuration)) {
    return undefined;
  }
  const apiKey = configuration.TRUEFOUNDRY_API_KEY;
  if (apiKey === undefined) {
    throw new Error('TRUEFOUNDRY_API_KEY is required when TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL is set.');
  }
  return new TrueFoundryServiceFoundryServerClient({
    serviceFoundryServerUrl: configuration.TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL,
    logger,
    httpTimeoutMs: configuration.TRUEFOUNDRY_SERVICEFOUNDRY_HTTP_TIMEOUT_MS,
    httpAgentTimeoutMs: configuration.TRUEFOUNDRY_SERVICEFOUNDRY_HTTP_AGENT_TIMEOUT_MS,
    tls: { enabled: configuration.TRUEFOUNDRY_MTLS_ENABLED, dir: configuration.TRUEFOUNDRY_MTLS_CERTS_DIR },
    apiKey,
  });
}

/**
 * Per-request model-provider store over a shared ServiceFoundry client, else {@link persistenceStore}.
 * `resolveAccessToken` overrides the caller's token, so a turn can run as its agent.
 */
function buildResolveModelProviderStore<TTransaction>(options: {
  persistenceStore: IModelProviderStore<TTransaction>;
  client: TrueFoundryServiceFoundryServerClient | undefined;
}): (c: Context, resolveAccessToken?: ResolveAccessToken) => IModelProviderStore<TTransaction> {
  return (c: Context, resolveAccessToken?: ResolveAccessToken) => {
    const { persistenceStore, client } = options;
    if (client) {
      return new TrueFoundryModelProviderStore<TTransaction>({
        client,
        resolveAccessToken: resolveAccessToken ?? callerAccessToken(resolveRequestContext(c)),
      });
    }
    return persistenceStore;
  };
}

/**
 * Per-request MCP store over ServiceFoundry. Without request context (scheduler / OAuth callback)
 * falls back to the local with-auth store. `resolveAccessToken` overrides the caller's token.
 */
function buildResolveMcpServerStore<TTransaction>(options: {
  persistenceStore: IMcpServerStore<TTransaction>;
  tokenStore: IOAuthTokenStore<TTransaction>;
  client: TrueFoundryServiceFoundryServerClient | undefined;
}): (c?: Context, resolveAccessToken?: ResolveAccessToken) => IMcpServerWithAuthStore<TTransaction> {
  return (c?: Context, resolveAccessToken?: ResolveAccessToken) => {
    const { persistenceStore, tokenStore, client } = options;
    if (c && client) {
      const requestContext = resolveRequestContext(c);
      const rawPerServerHeaders = c.req.header(X_TFG_MCP_HEADERS);
      return new TrueFoundryMcpServerStore<TTransaction>({
        client,
        resolveAccessToken: resolveAccessToken ?? callerAccessToken(requestContext),
        subject: requestContext.subject,
        perServerHeaders: rawPerServerHeaders ? parsePerServerMcpHeaders(rawPerServerHeaders) : {},
      });
    }
    const withAuthMcpPersistenceStore = new McpServerWithAuthStore<TTransaction>({
      store: persistenceStore,
      tokenStore,
      clientName: configuration.MCP_DCR_OAUTH_CLIENT_NAME,
    });
    return withAuthMcpPersistenceStore;
  };
}

/**
 * Both turn stores are built from one {@link ResolveAccessToken}, so a turn that runs as its agent
 * vends a single token instead of one per store.
 */
function buildResolveTurnStores<TTransaction>(options: {
  resolveModelProviderStore: (c: Context, resolveAccessToken?: ResolveAccessToken) => IModelProviderStore<TTransaction>;
  resolveMcpServerStore: (
    c?: Context,
    resolveAccessToken?: ResolveAccessToken,
  ) => IMcpServerWithAuthStore<TTransaction>;
  client: TrueFoundryServiceFoundryServerClient | undefined;
}): ResolveTurnStores<TTransaction> {
  const { resolveModelProviderStore, resolveMcpServerStore, client } = options;
  return (c: Context, runAsAgent: AgentRecord | undefined) => {
    const turnToken =
      client && runAsAgent
        ? agentAccessToken({ client, context: resolveRequestContext(c), agent: runAsAgent })
        : undefined;
    return {
      modelProviderStore: resolveModelProviderStore(c, turnToken),
      mcpServerStore: resolveMcpServerStore(c, turnToken),
    };
  };
}

/** Per-request agent store decorator over DB persistence, else {@link persistenceStore}. */
function buildResolveAgentStore(options: {
  persistenceStore: PostgresAgentStore;
  db: Kysely<PostgresDatabase>;
  client: TrueFoundryServiceFoundryServerClient | undefined;
}): (c: Context) => IAgentStore<Transaction<PostgresDatabase>> {
  const { persistenceStore, client, db } = options;
  return (c: Context) => {
    if (client) {
      return new TrueFoundryAgentStore({
        inner: persistenceStore,
        client,
        resolveAccessToken: callerAccessToken(resolveRequestContext(c)),
        db,
      });
    }
    return persistenceStore;
  };
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
  const modelProviderStore = new SqliteModelProviderStore(db);
  const mcpServerStore = new McpServerWithAuthStore({
    store: new SqliteMcpServerStore(db),
    tokenStore,
    clientName: configuration.MCP_DCR_OAUTH_CLIENT_NAME,
  });
  return {
    sessionStore: new SqliteSessionStore(db),
    sessionMetricsStore: new SqliteSessionMetricsStore(db),
    resolveModelProviderStore: () => modelProviderStore,
    resolveMcpServerStore: () => mcpServerStore,
    resolveTurnStores: () => ({ modelProviderStore, mcpServerStore }),
    resolveAgentStore: () => agentStore,
    withTransaction: callback => db.transaction().execute(callback),
    tokenStore,
    skillStore: new SqliteSkillStore(db),
    sandboxProviderStore: new SqliteSandboxProviderStore(db),
    scheduleStore: new SqliteScheduleStore(db),
    destroyDb: () => db.destroy(),
    redis: undefined,
    serviceFoundryClient: undefined,
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
  const modelProviderStore = new PostgresModelProviderStore(db);
  const mcpServerStore = new PostgresMcpServerStore(db);
  const serviceFoundryClient = createServiceFoundryServerClient(logger);
  const resolveModelProviderStore = buildResolveModelProviderStore({
    persistenceStore: modelProviderStore,
    client: serviceFoundryClient,
  });
  const resolveMcpServerStore = buildResolveMcpServerStore({
    persistenceStore: mcpServerStore,
    tokenStore,
    client: serviceFoundryClient,
  });
  return {
    sessionStore: new PostgresSessionStore(db),
    sessionMetricsStore: new PostgresSessionMetricsStore(db),
    resolveModelProviderStore,
    resolveMcpServerStore,
    resolveTurnStores: buildResolveTurnStores({
      resolveModelProviderStore,
      resolveMcpServerStore,
      client: serviceFoundryClient,
    }),
    resolveAgentStore: buildResolveAgentStore({
      persistenceStore: agentStore,
      db,
      client: serviceFoundryClient,
    }),
    withTransaction: callback => db.transaction().execute(callback),
    tokenStore,
    skillStore: new PostgresSkillStore(db),
    sandboxProviderStore: new PostgresSandboxProviderStore(db),
    scheduleStore: new PostgresScheduleStore(db),
    destroyDb: () => db.destroy(),
    redis: await connectRedis({ url: redisUrl, logger }),
    serviceFoundryClient,
  };
}

/** Keeps `TTransaction` concrete when wiring a single persistence topology into the app. */
async function createServerRuntime<TTransaction>(persistence: ServerPersistence<TTransaction>, logger: Logger) {
  const {
    sessionStore,
    sessionMetricsStore,
    resolveModelProviderStore,
    resolveMcpServerStore,
    resolveTurnStores,
    resolveAgentStore,
    withTransaction,
    tokenStore,
    skillStore,
    sandboxProviderStore,
    scheduleStore,
    destroyDb,
    redis,
    serviceFoundryClient,
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
  const mode = getTrueForgeAuthMode(configuration);
  if (mode === TrueForgeAuthMode.TrueFoundry) {
    if (serviceFoundryClient === undefined) {
      throw new Error('TrueFoundry mode requires TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL');
    }
    authenticator = createAuthenticator({
      mode: TrueForgeAuthMode.TrueFoundry,
      serviceFoundryClient,
    });
    authorizer = new TrueFoundryAuthorizer(serviceFoundryClient);
  } else if (mode === TrueForgeAuthMode.Oidc) {
    authenticator = createAuthenticator({ mode: TrueForgeAuthMode.Oidc });
    authorizer = new TrueForgeAuthorizer();
  } else {
    authenticator = createAuthenticator({ mode: TrueForgeAuthMode.Standalone });
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
    resolveTurnStores,
    resolveAgentStore,
    withTransaction,
    tokenStore,
    skillStore,
    sandboxProviderStore,
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
