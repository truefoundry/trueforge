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
import {
  configureOutboundFetches,
  configureOutboundUrlGuard,
  extractErrorLogFields,
} from '@truefoundry/trueforge-core/core';
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
let getPublicUiBasePath: typeof import('./config').getPublicUiBasePath;
let TrueForgeAuthMode: typeof import('./config').TrueForgeAuthMode;

try {
  ({
    default: configuration,
    isOidcConfigured,
    isTrueFoundryModeEnabled,
    getTrueForgeAuthMode,
    getPublicUiBasePath,
    TrueForgeAuthMode,
  } = await import('./config'));
  configureOutboundUrlGuard({
    enabled: configuration.NETWORK_POLICY_ENABLED,
    allowedHosts: configuration.OUTBOUND_URL_ALLOWED_HOSTS,
    blockedHosts: configuration.OUTBOUND_URL_BLOCKED_HOSTS,
  });
  configureOutboundFetches({
    outbound: {
      connectTimeoutMs: configuration.OUTBOUND_HTTP_CONNECT_TIMEOUT_MS,
      headersTimeoutMs: configuration.OUTBOUND_HTTP_HEADERS_TIMEOUT_MS,
      bodyTimeoutMs: configuration.OUTBOUND_HTTP_BODY_TIMEOUT_MS,
      maxRetries: configuration.OUTBOUND_HTTP_MAX_RETRIES,
      idempotent: true,
    },
    model: {
      connectTimeoutMs: configuration.MODEL_HTTP_CONNECT_TIMEOUT_MS,
      headersTimeoutMs: configuration.MODEL_HTTP_HEADERS_TIMEOUT_MS,
      bodyTimeoutMs: configuration.MODEL_HTTP_BODY_TIMEOUT_MS,
      maxRetries: configuration.MODEL_HTTP_MAX_RETRIES,
      idempotent: true,
    },
    mcp: {
      connectTimeoutMs: configuration.MCP_HTTP_CONNECT_TIMEOUT_MS,
      headersTimeoutMs: configuration.MCP_HTTP_HEADERS_TIMEOUT_MS,
      bodyTimeoutMs: configuration.MCP_HTTP_BODY_TIMEOUT_MS,
      maxRetries: configuration.MCP_HTTP_MAX_RETRIES,
      idempotent: false,
    },
  });
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
import { RequestReplyExecutor, RequestReplyRouter, type RedisClient } from '@truefoundry/trueforge-core/request-reply';
import type { Kysely, Transaction } from 'kysely';
import type { Logger } from 'winston';

import {
  createServerApp,
  type ResolveMcpServerStoreInput,
  type ResolveModelProviderStoreInput,
  type ResolveSkillStoreInput,
  type ResolveTurnSkillsStoreInput,
} from './app';
import { TrueForgeAuthorizer, type Authorizer } from './auth/authorizer';
import { createAuthenticator } from './auth/createAuthenticator';
import { resolveRequestContext, STANDALONE_REQUEST_CONTEXT, type RequestContext } from './auth/identity';
import { initOidc } from './auth/oidc';
import { McpCatalog } from './catalog/McpCatalog';
import { ModelCatalog } from './catalog/ModelCatalog';
import { SandboxCatalog } from './catalog/SandboxCatalog';
import { SkillCatalog } from './catalog/SkillCatalog';
import { WebSearchCatalog } from './catalog/WebSearchCatalog';
import { type DistributedServerConfiguration } from './config';
import { createController } from './controller';
import type { AgentRecord, IAgentStore } from './db/agentStore';
import type { IMcpServerStore, IMcpServerWithAuthStore } from './db/mcpServerStore';
import { McpServerWithAuthStore } from './db/McpServerWithAuthStore';
import type { IModelProviderStore } from './db/modelProviderStore';
import type { PostgresAgentStore } from './db/postgres/agent-store/PostgresAgentStore';
import type { Database as PostgresDatabase } from './db/postgres/types';
import type { ISandboxEnvironmentStore } from './db/sandboxEnvironmentStore';
import type { ISandboxProviderStore } from './db/sandboxProviderStore';
import type { IScheduleStore } from './db/scheduleStore';
import type { ISessionMetricsStore } from './db/sessionMetricsStore';
import type { ISkillStore } from './db/skillStore';
import type { Database as SqliteDatabase } from './db/sqlite/types';
import type { WithTransaction } from './db/transaction';
import type { IWebSearchProviderStore } from './db/webSearchProviderStore';
import { mountFrontend } from './frontend';
import { serverTlsServeOptions } from './http/tls';
import { createServerLogger, shouldColorize } from './logger';
import type { IOAuthTokenStore } from './mcp/auth/types';
import { PACKAGE_VERSION } from './packageVersion';
import { ActiveTurnRegistry } from './runtime/activeTurns';
import { EventSubscriptionRegistry } from './runtime/event-subscription';
import type { ConnectedRedis } from './runtime/redis';
import { initSentry } from './sentry';
import { printStandaloneStartupBanner } from './startupBanner';
import { InlineMcpServerStore } from './truefoundry/InlineMcpServerStore';
import { InlineModelProviderStore } from './truefoundry/InlineModelProviderStore';
import {
  assertInlineResourceHeadersAllowed,
  parseInlineMcpServers,
  parseInlineModelProviders,
  parseInlineSkills,
  X_TFG_MCP,
  X_TFG_MODELS,
  X_TFG_SKILLS,
  type InlineMcpServers,
  type InlineModelProviders,
  type InlineSkills,
} from './truefoundry/inlineResources';
import { InlineSkillStore } from './truefoundry/InlineSkillStore';
import {
  parsePerServerMcpHeaders,
  X_TFG_MCP_HEADERS,
  type PerServerMcpHeaders,
} from './truefoundry/perServerMcpHeaders';
import { TrueFoundryAgentStore } from './truefoundry/TrueFoundryAgentStore';
import { TrueFoundryAuthorizer } from './truefoundry/TrueFoundryAuthorizer';
import { TrueFoundryMcpServerStore } from './truefoundry/TrueFoundryMcpServerStore';
import { TrueFoundryModelProviderStore } from './truefoundry/TrueFoundryModelProviderStore';
import { TrueFoundrySandboxEnvironmentStore } from './truefoundry/TrueFoundrySandboxEnvironmentStore';
import { TrueFoundrySandboxProviderStore } from './truefoundry/TrueFoundrySandboxProviderStore';
import { TrueFoundryServiceFoundryServerClient } from './truefoundry/TrueFoundryServiceFoundryServerClient';
import { TrueFoundryAdminSkillStore, TrueFoundrySkillStore } from './truefoundry/TrueFoundrySkillStore';
import { TrueFoundryWebSearchProviderStore } from './truefoundry/TrueFoundryWebSearchProviderStore';

/** Persistence-layer model store resolve (RequestContext, not Hono Context). */
type ResolveModelProviderStore<TTransaction> = (input: {
  rc: RequestContext;
  runAsAgent?: AgentRecord;
  inlineModelProviders?: InlineModelProviders;
}) => IModelProviderStore<TTransaction>;

/** Persistence-layer MCP store resolve (RequestContext, not Hono Context). */
type ResolveMcpServerStore<TTransaction> = (input: {
  rc: RequestContext;
  runAsAgent?: AgentRecord;
  perServerHeaders?: PerServerMcpHeaders;
  inlineMcpServers?: InlineMcpServers;
}) => IMcpServerWithAuthStore<TTransaction>;

/** Turn skill mounts: closed-set `x-tfg-skills`, else the registry/DB store. */
type ResolveTurnSkillsStore<TTransaction> = (input: {
  inlineSkills?: InlineSkills;
}) => Pick<ISkillStore<TTransaction>, 'resolveTurnSkills'>;

/** Persistence + optional Redis wired for the selected topology. */
interface ServerPersistence<TTransaction> {
  withTransaction: WithTransaction<TTransaction>;
  sessionStore: ISessionStore;
  sessionMetricsStore: ISessionMetricsStore;
  tokenStore: IOAuthTokenStore<TTransaction>;
  scheduleStore: IScheduleStore<TTransaction>;
  mcpOAuthStore: IMcpServerWithAuthStore<TTransaction>;
  resolveModelProviderStore: ResolveModelProviderStore<TTransaction>;
  resolveMcpServerStore: ResolveMcpServerStore<TTransaction>;
  resolveSandboxProviderStore: (rc: RequestContext) => ISandboxProviderStore<TTransaction>;
  resolveWebSearchProviderStore: (rc: RequestContext) => IWebSearchProviderStore<TTransaction>;
  /** Per-request store: DB git skills, or TrueFoundry registry catalog (caller JWT). */
  resolveSkillStore: (rc: RequestContext) => ISkillStore<TTransaction>;
  resolveAgentStore: (rc: RequestContext) => IAgentStore<TTransaction>;
  /** extra pre-resolved stores for scheduled runs */
  agentStore: IAgentStore<TTransaction>;
  sandboxEnvironmentStore: ISandboxEnvironmentStore<TTransaction>;
  /** Context-free provider store for internal sandbox-env build progress. */
  sandboxProviderStore: ISandboxProviderStore<TTransaction>;
  /** Turn skill mounts: registry (API key) or closed-set `x-tfg-skills`. */
  resolveTurnSkillsStore: ResolveTurnSkillsStore<TTransaction>;
  destroyDb: () => Promise<void>;
  /** Connected Redis (client + mode) for distributed peering; undefined in standalone. */
  redis: ConnectedRedis | undefined;
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
    // this is unreachable because the config validation fails if TRUEFOUNDRY_API_KEY is not set
    // we will refactor config itself later to have a truefoundry section where this will be required
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

/** Per-request SFY skill catalog; otherwise {@link persistenceStore}. Caller JWT for list/validate. */
function buildResolveSkillStore<TTransaction>(options: {
  persistenceStore: ISkillStore<TTransaction>;
  client: TrueFoundryServiceFoundryServerClient | undefined;
}): (requestContext: RequestContext) => ISkillStore<TTransaction> {
  const { persistenceStore, client } = options;
  if (client === undefined) {
    return () => persistenceStore;
  }
  return requestContext =>
    new TrueFoundrySkillStore<TTransaction>({
      client,
      context: requestContext,
    });
}

/**
 * Turn skill mounts. Registry path uses the service API key; `inlineSkills` is a closed set from
 * `x-tfg-skills` with no registry lookup.
 */
function buildResolveTurnSkillsStore<TTransaction>(options: {
  persistenceStore: ISkillStore<TTransaction>;
  client: TrueFoundryServiceFoundryServerClient | undefined;
}): ResolveTurnSkillsStore<TTransaction> {
  const { persistenceStore, client } = options;
  const registry: Pick<ISkillStore<TTransaction>, 'resolveTurnSkills'> = client
    ? new TrueFoundryAdminSkillStore({ client })
    : persistenceStore;
  return input => {
    if (input.inlineSkills !== undefined) {
      return new InlineSkillStore({ inline: input.inlineSkills });
    }
    return registry;
  };
}

/**
 * Per-request model-provider store over a shared ServiceFoundry client, else {@link persistenceStore}.
 * `runAsAgent` is set only when a turn should use a saved agent's token.
 */
function buildResolveModelProviderStore<TTransaction>(options: {
  persistenceStore: IModelProviderStore<TTransaction>;
  client: TrueFoundryServiceFoundryServerClient | undefined;
  logger: Logger;
}): ResolveModelProviderStore<TTransaction> {
  return input => {
    const { persistenceStore, client } = options;
    if (client) {
      const store = new TrueFoundryModelProviderStore<TTransaction>({
        client,
        requestContext: input.rc,
        agent: input.runAsAgent,
        logger: options.logger,
      });
      if (input.inlineModelProviders !== undefined) {
        return new InlineModelProviderStore({ inner: store, inline: input.inlineModelProviders });
      }
      return store;
    }
    return persistenceStore;
  };
}

/**
 * Per-request MCP store over ServiceFoundry. `runAsAgent` selects a saved agent's token for turns.
 */
function buildResolveMcpServerStore<TTransaction>(options: {
  persistenceStore: IMcpServerStore<TTransaction>;
  tokenStore: IOAuthTokenStore<TTransaction>;
  client: TrueFoundryServiceFoundryServerClient | undefined;
  logger: Logger;
}): ResolveMcpServerStore<TTransaction> {
  const withAuthMcpPersistenceStore = new McpServerWithAuthStore<TTransaction>({
    store: options.persistenceStore,
    tokenStore: options.tokenStore,
    clientName: configuration.MCP_DCR_OAUTH_CLIENT_NAME,
  });
  return input => {
    const { client } = options;
    if (client) {
      const store = new TrueFoundryMcpServerStore<TTransaction>({
        client,
        requestContext: input.rc,
        agent: input.runAsAgent,
        logger: options.logger,
        ...(input.perServerHeaders === undefined ? {} : { perServerHeaders: input.perServerHeaders }),
      });
      if (input.inlineMcpServers !== undefined) {
        return new InlineMcpServerStore({ inner: store, inline: input.inlineMcpServers });
      }
      return store;
    }
    return withAuthMcpPersistenceStore;
  };
}

/** Per-request agent store decorator over DB persistence, else {@link persistenceStore}. */
function buildResolveAgentStore(options: {
  persistenceStore: PostgresAgentStore;
  db: Kysely<PostgresDatabase>;
  client: TrueFoundryServiceFoundryServerClient | undefined;
}): (rc: RequestContext) => IAgentStore<Transaction<PostgresDatabase>> {
  const { persistenceStore, client, db } = options;
  return rc => {
    if (client) {
      return new TrueFoundryAgentStore({
        inner: persistenceStore,
        client,
        context: rc,
        db,
      });
    }
    return persistenceStore;
  };
}

/**
 * Sandbox-provider store resolver. In TrueFoundry mode the shared env-backed store is reused;
 * otherwise the persistence store is reused as-is.
 */
function buildResolveSandboxProviderStore<TTransaction>(options: {
  persistenceStore: ISandboxProviderStore<TTransaction>;
}): (rc: RequestContext) => ISandboxProviderStore<TTransaction> {
  const { persistenceStore } = options;
  if (isTrueFoundryModeEnabled(configuration)) {
    return () => new TrueFoundrySandboxProviderStore<TTransaction>();
  }
  return () => persistenceStore;
}

function wrapSandboxEnvironmentStore<TTransaction>(
  persistenceStore: ISandboxEnvironmentStore<TTransaction>,
): ISandboxEnvironmentStore<TTransaction> {
  if (isTrueFoundryModeEnabled(configuration)) {
    // Discriminator only — full resolve validates secrets/settings used elsewhere.
    return new TrueFoundrySandboxEnvironmentStore(persistenceStore, {
      envSupported: configuration.TRUEFOUNDRY_SANDBOX_PROVIDER === 'daytona',
    });
  }
  return persistenceStore;
}

function buildResolveWebSearchProviderStore<TTransaction>(options: {
  persistenceStore: IWebSearchProviderStore<TTransaction>;
}): (rc: RequestContext) => IWebSearchProviderStore<TTransaction> {
  const { persistenceStore } = options;
  if (isTrueFoundryModeEnabled(configuration)) {
    return () => new TrueFoundryWebSearchProviderStore<TTransaction>();
  }
  return () => persistenceStore;
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
      import('./db/sqlite/web-search-provider-store/SqliteWebSearchProviderStore'),
      import('./db/sqlite/agent-store/SqliteAgentStore'),
      import('./db/sqlite/schedule-store/SqliteScheduleStore'),
      import('./db/sqlite/sandbox-environment-store/SqliteSandboxEnvironmentStore'),
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
    { SqliteWebSearchProviderStore },
    { SqliteAgentStore },
    { SqliteScheduleStore },
    { SqliteSandboxEnvironmentStore },
  ] = sqliteStores;

  const db = createSqliteDb(sqlitePath);
  await migrateSqliteToLatest(db);
  logger.info(`Standalone mode: sqlite at ${sqlitePath}`);
  logger.info('Standalone mode: executor peering disabled and Redis unused');

  const tokenStore = new SqliteOAuthTokenStore(db);
  const agentStore = new SqliteAgentStore(db);
  const sandboxEnvironmentStore = wrapSandboxEnvironmentStore(new SqliteSandboxEnvironmentStore(db));
  const modelProviderStore = new SqliteModelProviderStore(db);
  const mcpServerStore = new McpServerWithAuthStore({
    store: new SqliteMcpServerStore(db),
    tokenStore,
    clientName: configuration.MCP_DCR_OAUTH_CLIENT_NAME,
  });
  const sandboxProviderStore = new SqliteSandboxProviderStore(db);
  const webSearchProviderStore = new SqliteWebSearchProviderStore(db);
  const skillStore = new SqliteSkillStore(db);
  return {
    withTransaction: callback => db.transaction().execute(callback),
    sessionStore: new SqliteSessionStore(db),
    sessionMetricsStore: new SqliteSessionMetricsStore(db),
    mcpOAuthStore: mcpServerStore,
    tokenStore,
    scheduleStore: new SqliteScheduleStore(db),
    resolveModelProviderStore: () => modelProviderStore,
    resolveMcpServerStore: () => mcpServerStore,
    resolveSandboxProviderStore: () => sandboxProviderStore,
    resolveWebSearchProviderStore: () => webSearchProviderStore,
    resolveSkillStore: () => skillStore,
    resolveAgentStore: () => agentStore,
    agentStore,
    sandboxEnvironmentStore,
    sandboxProviderStore,
    resolveTurnSkillsStore: buildResolveTurnSkillsStore({
      persistenceStore: skillStore,
      client: undefined,
    }),
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
    DATABASE_SSL: databaseSsl,
    DATABASE_POOL_MAX: databasePoolMax,
    POSTGRES_STATEMENT_TIMEOUT_MS: statementTimeoutMs,
    POSTGRES_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS: idleInTransactionSessionTimeoutMs,
    REDIS_CONNECTION: redisConnection,
    REDIS_CONNECT_TIMEOUT_MS: redisConnectTimeoutMs,
    REDIS_PING_INTERVAL_MS: redisPingIntervalMs,
    REDIS_TLS_ENABLED: redisTlsEnabled,
    REDIS_TLS_CA_CERT: redisTlsCaCert,
    REDIS_TLS_REJECT_UNAUTHORIZED: redisTlsRejectUnauthorized,
    REDIS_TLS_SERVERNAME: redisTlsServerName,
    REDIS_TLS_CERT: redisTlsCert,
    REDIS_TLS_KEY: redisTlsKey,
    REDIS_TLS_KEY_PASSPHRASE: redisTlsKeyPassphrase,
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
      import('./db/postgres/web-search-provider-store/PostgresWebSearchProviderStore'),
      import('./db/postgres/agent-store/PostgresAgentStore'),
      import('./db/postgres/schedule-store/PostgresScheduleStore'),
      import('./db/postgres/sandbox-environment-store/PostgresSandboxEnvironmentStore'),
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
    { PostgresWebSearchProviderStore },
    { PostgresAgentStore },
    { PostgresScheduleStore },
    { PostgresSandboxEnvironmentStore },
  ] = postgresStores;

  logger.info('Connecting to Postgres');
  const db = createDb({
    connectionString: databaseUrl,
    poolMax: databasePoolMax,
    statementTimeoutMs,
    idleInTransactionSessionTimeoutMs,
    ssl: databaseSsl,
  });
  await migrateToLatest(db);
  logger.info(`Executor id: ${executorId}`);
  if (redisConnection === undefined) {
    throw new Error(
      'Set exactly one Redis transport for the server when STANDALONE=false: REDIS_URL, REDIS_HOST, or ' +
        'REDIS_SENTINEL_ENABLED with REDIS_SENTINEL_NODES and REDIS_SENTINEL_MASTER_NAME.',
    );
  }
  const serviceFoundryClient = createServiceFoundryServerClient(logger);
  const tokenStore = new PostgresOAuthTokenStore(db);
  const modelProviderStore = new PostgresModelProviderStore(db);
  const mcpServerStore = new PostgresMcpServerStore(db);
  const mcpServerWithAuthStore = new McpServerWithAuthStore({
    store: mcpServerStore,
    tokenStore,
    clientName: configuration.MCP_DCR_OAUTH_CLIENT_NAME,
  });
  const sandboxProviderStore = new PostgresSandboxProviderStore(db);
  const webSearchProviderStore = new PostgresWebSearchProviderStore(db);
  const skillStore = new PostgresSkillStore(db);
  const agentStore = new PostgresAgentStore(db);
  const sandboxEnvironmentStore = wrapSandboxEnvironmentStore(new PostgresSandboxEnvironmentStore(db));
  const resolveTurnSkillsStore = buildResolveTurnSkillsStore({
    persistenceStore: skillStore,
    client: serviceFoundryClient,
  });
  const resolveModelProviderStore = buildResolveModelProviderStore({
    persistenceStore: modelProviderStore,
    client: serviceFoundryClient,
    logger,
  });
  const resolveMcpServerStore = buildResolveMcpServerStore({
    persistenceStore: mcpServerStore,
    tokenStore,
    client: serviceFoundryClient,
    logger,
  });
  const resolveAgentStore = buildResolveAgentStore({
    persistenceStore: agentStore,
    db,
    client: serviceFoundryClient,
  });
  const resolveSandboxProviderStore = buildResolveSandboxProviderStore({
    persistenceStore: sandboxProviderStore,
  });
  const resolveWebSearchProviderStore = buildResolveWebSearchProviderStore({
    persistenceStore: webSearchProviderStore,
  });
  const resolveSkillStore = buildResolveSkillStore({
    persistenceStore: skillStore,
    client: serviceFoundryClient,
  });
  return {
    withTransaction: callback => db.transaction().execute(callback),
    sessionStore: new PostgresSessionStore(db),
    sessionMetricsStore: new PostgresSessionMetricsStore(db),
    mcpOAuthStore: mcpServerWithAuthStore,
    tokenStore,
    scheduleStore: new PostgresScheduleStore(db),
    resolveModelProviderStore,
    resolveMcpServerStore,
    resolveSandboxProviderStore,
    resolveWebSearchProviderStore,
    resolveSkillStore,
    resolveAgentStore,
    agentStore,
    sandboxEnvironmentStore,
    sandboxProviderStore: resolveSandboxProviderStore(STANDALONE_REQUEST_CONTEXT),
    resolveTurnSkillsStore,
    destroyDb: () => db.destroy(),
    redis: await connectRedis({
      connection: redisConnection,
      connectTimeoutMs: redisConnectTimeoutMs,
      pingIntervalMs: redisPingIntervalMs,
      logger,
      tls: {
        enabled: redisTlsEnabled,
        caCert: redisTlsCaCert,
        rejectUnauthorized: redisTlsRejectUnauthorized,
        serverName: redisTlsServerName,
        cert: redisTlsCert,
        key: redisTlsKey,
        keyPassphrase: redisTlsKeyPassphrase,
      },
    }),
    serviceFoundryClient,
  };
}

/** Keeps `TTransaction` concrete when wiring a single persistence topology into the app. */
async function createServerRuntime<TTransaction>(persistence: ServerPersistence<TTransaction>, logger: Logger) {
  const {
    withTransaction,
    sessionStore,
    sessionMetricsStore,
    tokenStore,
    scheduleStore,
    mcpOAuthStore,
    agentStore,
    sandboxEnvironmentStore,
    resolveTurnSkillsStore,
    destroyDb,
    redis,
    serviceFoundryClient,
  } = persistence;

  const activeTurns = new ActiveTurnRegistry();
  const requestReplyRouter = new RequestReplyRouter();
  const eventSubscriptions = new EventSubscriptionRegistry<TurnStreamingEvent>(redis?.client);
  const sessions = new Sessions({ sessionStore });

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

  // Standalone owns the control loops in-process; they hand off via HTTP loopback
  // (same transport as the dedicated controller in distributed mode).
  const controller = configuration.STANDALONE
    ? createController({
        scheduleStore,
        withTransaction,
        logger,
      })
    : undefined;

  // Hono handlers get Context; persistence resolvers take RequestContext.
  // x-tfg-skills / x-tfg-mcp / x-tfg-models are rejected unless allowInlineResources
  // (inline session create or spec replace, or a turn for an inline session).
  // x-tfg-mcp-headers is separate (per-server invoke headers).
  const isTrueFoundryMode = isTrueFoundryModeEnabled(configuration);
  const resolveModelProviderStore = (input: ResolveModelProviderStoreInput) => {
    const { c, runAsAgent, allowInlineResources = false } = input;
    const rawInlineModelsHeader = c.req.header(X_TFG_MODELS);
    if (rawInlineModelsHeader !== undefined) {
      assertInlineResourceHeadersAllowed({
        headerNames: [X_TFG_MODELS],
        isTrueFoundryMode,
        allowInlineResources,
      });
    }
    return persistence.resolveModelProviderStore({
      rc: resolveRequestContext(c),
      ...(runAsAgent !== undefined ? { runAsAgent } : {}),
      ...(rawInlineModelsHeader !== undefined
        ? { inlineModelProviders: parseInlineModelProviders(rawInlineModelsHeader) }
        : {}),
    });
  };
  const resolveMcpServerStore = (input: ResolveMcpServerStoreInput) => {
    const { c, runAsAgent, allowInlineResources = false } = input;
    if (c === undefined) {
      return mcpOAuthStore;
    }
    const rawPerServerHeaders = c.req.header(X_TFG_MCP_HEADERS);
    const rawInlineMcpServersHeader = c.req.header(X_TFG_MCP);
    if (rawInlineMcpServersHeader !== undefined) {
      assertInlineResourceHeadersAllowed({
        headerNames: [X_TFG_MCP],
        isTrueFoundryMode,
        allowInlineResources,
      });
    }
    return persistence.resolveMcpServerStore({
      rc: resolveRequestContext(c),
      ...(runAsAgent !== undefined ? { runAsAgent } : {}),
      ...(rawPerServerHeaders !== undefined ? { perServerHeaders: parsePerServerMcpHeaders(rawPerServerHeaders) } : {}),
      ...(rawInlineMcpServersHeader !== undefined
        ? { inlineMcpServers: parseInlineMcpServers(rawInlineMcpServersHeader) }
        : {}),
    });
  };
  const resolveAgentStore = (c: Context) => persistence.resolveAgentStore(resolveRequestContext(c));
  const resolveSandboxProviderStore = (c: Context) => persistence.resolveSandboxProviderStore(resolveRequestContext(c));
  const resolveWebSearchProviderStore = (c: Context) =>
    persistence.resolveWebSearchProviderStore(resolveRequestContext(c));
  // Catalog and agent saves reject x-tfg-skills. Inline session create and spec replace opt in and get a
  // closed-set store for validation only; the header is not persisted.
  const resolveSkillStore = (input: ResolveSkillStoreInput) => {
    const { c, allowInlineResources = false } = input;
    const rawInlineSkillsHeader = c.req.header(X_TFG_SKILLS);
    if (rawInlineSkillsHeader !== undefined) {
      assertInlineResourceHeadersAllowed({
        headerNames: [X_TFG_SKILLS],
        isTrueFoundryMode,
        allowInlineResources,
      });
      return new InlineSkillStore({ inline: parseInlineSkills(rawInlineSkillsHeader) });
    }
    return persistence.resolveSkillStore(resolveRequestContext(c));
  };
  // Turn mounts: registry (API key), or closed-set header skills when `c` + allowInlineResources.
  // Schedules omit `c` and always get the registry/DB store.
  const resolveTurnSkillsStoreForRequest = (input: ResolveTurnSkillsStoreInput) => {
    const { c, allowInlineResources = false } = input;
    if (c === undefined) {
      return resolveTurnSkillsStore({});
    }
    const rawInlineSkillsHeader = c.req.header(X_TFG_SKILLS);
    if (rawInlineSkillsHeader !== undefined) {
      assertInlineResourceHeadersAllowed({
        headerNames: [X_TFG_SKILLS],
        isTrueFoundryMode,
        allowInlineResources,
      });
    }
    return resolveTurnSkillsStore(
      rawInlineSkillsHeader === undefined ? {} : { inlineSkills: parseInlineSkills(rawInlineSkillsHeader) },
    );
  };
  const app = createServerApp({
    modelCatalog: ModelCatalog.load(),
    mcpCatalog: McpCatalog.load(),
    skillCatalog: SkillCatalog.load(),
    sandboxCatalog: SandboxCatalog.load(),
    webSearchCatalog: WebSearchCatalog.load(),
    resolveModelProviderStore,
    resolveMcpServerStore,
    resolveAgentStore,
    resolveSandboxProviderStore,
    resolveWebSearchProviderStore,
    resolveSkillStore,
    resolveTurnSkillsStore: resolveTurnSkillsStoreForRequest,
    withTransaction,
    tokenStore,
    scheduleStore,
    agentStore,
    sandboxEnvironmentStore,
    sandboxProviderStore: persistence.sandboxProviderStore,
    sessionStore,
    sessionMetricsStore,
    sessions,
    activeTurns,
    redis: redis?.client,
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
  });

  await initSentry(configuration, logger, { tags: { component: 'server' } });

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

  if (
    mountFrontend(app, {
      dir: configuration.FRONTEND_DIR,
      uiBasePath: getPublicUiBasePath(),
    })
  ) {
    logger.info(`Serving frontend from ${configuration.FRONTEND_DIR}`);
  } else {
    logger.warn(
      `No frontend build at ${configuration.FRONTEND_DIR}: serving the API only. ` +
        'Run `pnpm --filter frontend build` (and copy via build:frontend-assets) to serve the UI, or `pnpm standalone:dev` / `pnpm dev` for Vite.',
    );
  }

  // After createServerApp so every request-reply route is registered before
  // the executor starts consuming messages. Standalone Redis needs a dedicated
  // subscriber connection (a subscribed client cannot issue normal commands);
  // Sentinel owns pub/sub on the shared client. Connect before init() so init()
  // awaits the initial subscribe + heartbeat — the replica is reachable for
  // peering before the HTTP server starts.
  let requestReplySubscriber: RedisClient | undefined;
  let requestReplyExecutor: RequestReplyExecutor | undefined;
  if (redis) {
    if (redis.mode !== 'sentinel') {
      requestReplySubscriber = redis.client.duplicate();
      requestReplySubscriber.on('error', (error: Error) => {
        logger.error('[RedisSubscriber] Client error', extractErrorLogFields(error));
      });
      await requestReplySubscriber.connect();
    } else {
      requestReplySubscriber = redis.client;
    }
    requestReplyExecutor = new RequestReplyExecutor({
      executorId: configuration.EXECUTOR_ID,
      redis: redis.client,
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
    enabled: !configuration.STANDALONE && configuration.MTLS_ENABLED,
    dir: configuration.MTLS_CERTS_DIR,
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
      // Redis clients (Set dedupes when Sentinel shares one client for pub/sub).
      await requestReplyExecutor?.drain();
      const redisClients = new Set<RedisClient>();
      if (requestReplySubscriber !== undefined) {
        redisClients.add(requestReplySubscriber);
      }
      if (redis !== undefined) {
        redisClients.add(redis.client);
      }
      for (const client of redisClients) {
        await client.close().catch((error: unknown) => {
          logger.warn('[Redis] Error closing client during shutdown', extractErrorLogFields(error));
        });
      }
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
