/** The API: resource routers, the OpenAPI document and Swagger UI, all under /api/v1. */
import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono, z } from '@hono/zod-openapi';
import type { ISessionStore, Sessions, TurnStreamingEvent } from '@truefoundry/trueforge-core/agent-session';
import { extractErrorLogFields } from '@truefoundry/trueforge-core/core';
import type { RedisClient, RequestReplyRouter } from '@truefoundry/trueforge-core/request-reply';
import type { Context, ErrorHandler, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { randomUUID } from 'node:crypto';
import type { Configuration } from 'openid-client';
import type { Logger } from 'winston';
import { createAgentsRouter } from './apis/agents';
import { createAuthRouter } from './apis/auth';
import { createCapabilitiesRouter } from './apis/capabilities';
import { createCatalogRouter } from './apis/catalog';
import { createMcpOAuthRouter } from './apis/mcpOAuth';
import { createMcpServersRouter } from './apis/mcpServers';
import { createModelsRouter } from './apis/models';
import { createPermissionsRouter } from './apis/permissions';
import { createSandboxEnvironmentBuildRouter } from './apis/sandboxEnvironmentBuild';
import { createSandboxEnvironmentsRouter } from './apis/sandboxEnvironments';
import { createScheduleExecutionRouter, createSchedulesRouter } from './apis/schedules';
import { createInternalMetricsRouter } from './apis/sessionMetrics';
import { createInternalSessionsRouter, createSessionsRouter } from './apis/sessions';
import { createSettingsRouter } from './apis/settings';
import { createAvailableSkillsRouter } from './apis/skills';
import { createTurnsRouter, type ResolveTurnExecutionStoresInput, type TurnExecutionStores } from './apis/turns';
import type { Authenticator } from './auth/authenticator';
import type { Authorizer } from './auth/authorizer';
import { resolveRequestContext, type RequestContext } from './auth/identity';
import {
  createAdminAuthMiddleware,
  createApiKeyAuthMiddleware,
  createAuthMiddleware,
  tryAuthenticate,
} from './auth/middleware';
import type { McpCatalog } from './catalog/McpCatalog';
import type { ModelCatalog } from './catalog/ModelCatalog';
import type { SandboxCatalog } from './catalog/SandboxCatalog';
import type { SkillCatalog } from './catalog/SkillCatalog';
import type { WebSearchCatalog } from './catalog/WebSearchCatalog';
import configuration, { getPublicUiBasePath, getTrueForgeAuthMode, TrueForgeAuthMode } from './config';
import type { AgentRecord, IAgentStore } from './db/agentStore';
import type { IMcpServerWithAuthStore } from './db/mcpServerStore';
import type { IModelProviderStore } from './db/modelProviderStore';
import type { ISandboxEnvironmentStore } from './db/sandboxEnvironmentStore';
import type { ISandboxProviderStore } from './db/sandboxProviderStore';
import type { IScheduleStore } from './db/scheduleStore';
import type { ISessionMetricsStore } from './db/sessionMetricsStore';
import type { ISkillStore } from './db/skillStore';
import type { WithTransaction } from './db/transaction';
import type { IWebSearchProviderStore } from './db/webSearchProviderStore';
import { createHttpMetrics } from './http/prometheus';
import { createClientCertificateMiddleware } from './http/tls';
import { runWithLogContext, updateLogContext, type LogContext } from './logger';
import type { IOAuthTokenStore } from './mcp/auth/types';
import { PACKAGE_VERSION } from './packageVersion';
import { OPENAPI_DOCUMENT_TAGS } from './routes/openapiTags';
import type { ActiveTurnRegistry } from './runtime/activeTurns';
import type { EventSubscriptionRegistry } from './runtime/event-subscription';
import { InvalidCronError } from './schemas/schedule';
import { zodErrorResponse, zodValidationHook } from './zodErrorResponse';

const BEARER_AUTH_SCHEME = 'BearerAuth';

const REQUEST_ID_HEADER = 'x-request-id';

/** Single token. Rejects spaces, quotes, and newlines so a caller cannot break a JSON log line. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,200}$/;

function requestIdFromHeader(raw: string | undefined): string {
  if (raw !== undefined && SAFE_REQUEST_ID.test(raw)) {
    return raw;
  }
  return randomUUID();
}

/**
 * Opens a log context for the request and echoes `x-request-id`.
 * Registered first so the access log and error handler run inside it.
 */
export function createRequestLogContextMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const request_id = requestIdFromHeader(c.req.header(REQUEST_ID_HEADER));
    c.header(REQUEST_ID_HEADER, request_id);
    await runWithLogContext({ request_id }, async () => {
      await next();
    });
  };
}

/** Stamp session and turn ids from the matched route params. Skips `/api/internal/sessions/...`. */
export function createSessionPathLogContextMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const session_id = c.req.param('session_id');
    const turn_id = c.req.param('turn_id');
    const fields: LogContext = {
      ...(session_id === undefined ? {} : { session_id }),
      ...(turn_id === undefined ? {} : { turn_id }),
    };
    if (session_id !== undefined || turn_id !== undefined) {
      updateLogContext(fields);
    }
    await next();
  };
}

function withAuth(router: OpenAPIHono, middleware: MiddlewareHandler): OpenAPIHono {
  const shell = new OpenAPIHono();
  shell.use('*', middleware);
  shell.route('/', router);
  return shell;
}

function withAdminAuth(router: OpenAPIHono, middleware: MiddlewareHandler): OpenAPIHono {
  const shell = new OpenAPIHono();
  shell.use('*', middleware);
  shell.route('/', router);
  return shell;
}

/** One line per request: method, path, status, duration. Skips `/healthz` and `/assets/`. */
export function createAccessLogMiddleware(logger: Logger): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now();
    await next();
    const path = c.req.path;
    if (path === '/healthz' || path.startsWith('/assets/')) {
      return;
    }
    logger.info('request', {
      method: c.req.method,
      path,
      status: c.res.status,
      duration_ms: Math.round(performance.now() - started),
    });
  };
}

/** Hono bodyLimit wrapper that returns the API error envelope on 413. */
export function createRequestBodyLimitMiddleware(maxSize: number): MiddlewareHandler {
  return bodyLimit({
    maxSize,
    onError: c =>
      c.json({ error: { message: `Request body exceeds the maximum size of ${String(maxSize)} bytes` } }, 413),
  });
}

/** Expected rejections whose stack says nothing a reader needs; kept out of warn-level logs. */
const QUIET_CLIENT_ERROR_STATUSES = new Set([401, 403, 404]);

export function createAppErrorHandler(params: { logger: Logger }): ErrorHandler {
  return (error, c) => {
    // One line with the traceback, so a failed request can be traced to the throw site.
    const logError = (status: number, message: string): void => {
      const fields = {
        method: c.req.method,
        path: c.req.path,
        status,
        ...extractErrorLogFields(error),
      };
      if (status >= 500) {
        params.logger.error(message, fields);
        return;
      }
      if (QUIET_CLIENT_ERROR_STATUSES.has(status)) {
        params.logger.debug(message, fields);
        return;
      }
      params.logger.warn(message, fields);
    };

    if (error instanceof z.ZodError) {
      logError(400, 'Client API error');
      return zodErrorResponse(c, error);
    }
    if (error instanceof InvalidCronError) {
      logError(400, 'Client API error');
      return c.json({ error: { message: error.message } }, 400);
    }
    if (error instanceof HTTPException) {
      logError(error.status, error.status >= 500 ? 'Server API error' : 'Client API error');
      return c.json({ error: { message: error.message } }, error.status);
    }
    logError(500, 'Unhandled error');
    return c.json({ error: { message: 'Internal server error' } }, 500);
  };
}

const openApiDocConfig = {
  openapi: '3.1.0',
  info: {
    title: 'TrueForge API',
    description:
      'HTTP API for the TrueForge agent server (`/api/v1`). Interactive docs are served at `/api/v1/docs` ' +
      '(OpenAPI JSON at `/api/v1/openapi.json`).\n\n' +
      '**Authentication:** Standalone auth accepts requests without credentials — middleware ' +
      'stamps a local default user. When OIDC or TrueFoundry auth is configured, protected routes require a valid ' +
      'cookie or `Authorization: Bearer` token. There is no built-in API-key scheme; ' +
      'pass custom headers only if your reverse proxy or IdP layer requires them.\n\n' +
      'Covers DB-backed sessions, the agent registry, settings catalogs, and model/MCP/skill/sandbox providers.',
    version: PACKAGE_VERSION,
  },
  tags: OPENAPI_DOCUMENT_TAGS,
};

/** Registers the Bearer ID-token scheme used by {@link buildOpenApiDocument}. */
export function registerOpenApiBearerAuth(app: OpenAPIHono): void {
  app.openAPIRegistry.registerComponent('securitySchemes', BEARER_AUTH_SCHEME, {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description:
      'Caller credential (`Authorization: Bearer <token>`). Required on protected routes when auth is enabled. ' +
      'Browser sessions may use the HttpOnly `id_token` or `accessToken` cookie instead.',
  });
}

/**
 * Single source for both the served document and the one the SDK is built from.
 * When `authEnabled`, advertises required Bearer auth on operations that inherit global security.
 * `serverUrl` is the public prefix for Try it out (e.g. `/custom/proxy/path`); omit for the SDK spec.
 */
export function buildOpenApiDocument(app: OpenAPIHono, options?: { authEnabled?: boolean; serverUrl?: string }) {
  const authEnabled = options?.authEnabled ?? false;
  if (authEnabled) {
    registerOpenApiBearerAuth(app);
  }
  const serverUrl = options?.serverUrl;
  return app.getOpenAPI31Document({
    ...openApiDocConfig,
    ...(authEnabled ? { security: [{ [BEARER_AUTH_SCHEME]: [] }] } : {}),
    ...(serverUrl !== undefined && serverUrl !== '' ? { servers: [{ url: serverUrl }] } : {}),
  });
}

function routeNotFound(c: Context) {
  return c.json({ error: { message: `Route not found: ${c.req.method} ${c.req.path}` } }, 404);
}

/** HTTP model-provider store resolve. `allowInlineResources` for inline session create, spec replace, and inline-session turns. */
export interface ResolveModelProviderStoreInput {
  c: Context;
  runAsAgent?: AgentRecord;
  allowInlineResources?: boolean;
}

/** HTTP MCP store resolve. Omit `c` for the unauthenticated OAuth callback. */
export interface ResolveMcpServerStoreInput {
  c?: Context;
  runAsAgent?: AgentRecord;
  allowInlineResources?: boolean;
}

/**
 * Turn skill-mount resolve. Omit `c` for schedules (registry/DB only).
 * `allowInlineResources` only for turns on inline sessions.
 */
export interface ResolveTurnSkillsStoreInput {
  c?: Context;
  allowInlineResources?: boolean;
}

/** HTTP skill-store resolve. `allowInlineResources` for inline session create and spec replace. */
export interface ResolveSkillStoreInput {
  c: Context;
  allowInlineResources?: boolean;
}

export interface ServerDeps<TTransaction> {
  activeTurns: ActiveTurnRegistry<TTransaction>;
  /** Persistence agent store (schedule runs resolve the bound agent without an HTTP caller). */
  agentStore: IAgentStore<TTransaction>;
  /** Startup-selected authenticator; middleware is built from this once per app. */
  authenticator: Authenticator;
  /** Startup-selected agent authorization policy. */
  authorizer: Authorizer;
  /** Hands out each turn's resumable event stream to the create and subscribe handlers. */
  eventSubscriptions: EventSubscriptionRegistry<TurnStreamingEvent>;
  logger: Logger;
  mcpCatalog: McpCatalog;
  modelCatalog: ModelCatalog;
  /** Discovered openid-client configuration; undefined when browser login is disabled. */
  oidcClient: Configuration | undefined;
  /** Redis client used for redis request-reply */
  redis?: RedisClient | undefined;
  /** Redis request-reply router for registering peer handlers. */
  requestReplyRouter: RequestReplyRouter;
  /** Per-request store: DB singleton, or a token-bound TrueFoundry decorator in TrueFoundry mode. */
  resolveAgentStore: (requestContext: RequestContext) => IAgentStore<TTransaction>;
  /**
   * Per-request store: DB singleton, or a token-bound TrueFoundry store in TrueFoundry mode.
   * The unauthenticated OAuth callback omits `c` and gets the DB persistence store.
   */
  resolveMcpServerStore: (input: ResolveMcpServerStoreInput) => IMcpServerWithAuthStore<TTransaction>;
  /** Per-request store: DB singleton, or a token-bound TrueFoundry store in TrueFoundry mode. */
  resolveModelProviderStore: (input: ResolveModelProviderStoreInput) => IModelProviderStore<TTransaction>;
  /** Per-request store: DB git skills, or TrueFoundry registry catalog in TrueFoundry mode. */
  resolveSkillStore: (input: ResolveSkillStoreInput) => ISkillStore<TTransaction>;
  /**
   * Stores for running a turn. HTTP create and POST /events pass the request.
   * A peered `turns/send-events` passes the forwarded context and headers.
   */
  resolveTurnExecutionStores: (
    input: ResolveTurnExecutionStoresInput<TTransaction>,
  ) => Promise<TurnExecutionStores<TTransaction>>;
  /**
   * Turn skill mounts. HTTP turns may apply `x-tfg-skills` when allowInlineResources is set;
   * schedules call with `{}` (registry/DB only).
   */
  resolveTurnSkillsStore: (input: ResolveTurnSkillsStoreInput) => Pick<ISkillStore<TTransaction>, 'resolveTurnSkills'>;
  sandboxCatalog: SandboxCatalog;
  /** Sandbox environment parent + version persistence, or the shared TrueFoundry store. */
  sandboxEnvironmentStore: ISandboxEnvironmentStore<TTransaction>;
  /** DB singleton, or the env-backed shared store in TrueFoundry mode. */
  sandboxProviderStore: ISandboxProviderStore<TTransaction>;
  scheduleStore: IScheduleStore<TTransaction>;
  sessionMetricsStore: ISessionMetricsStore;
  sessions: Sessions<TTransaction>;
  sessionStore: ISessionStore<TTransaction>;
  skillCatalog: SkillCatalog;
  tokenStore: IOAuthTokenStore<TTransaction>;
  webSearchCatalog: WebSearchCatalog;
  /** DB singleton, or the env-backed shared store in TrueFoundry mode. */
  webSearchProviderStore: IWebSearchProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
}

export function createServerApp<TTransaction>(deps: ServerDeps<TTransaction>) {
  const app = new OpenAPIHono({ defaultHook: zodValidationHook });
  const authMiddleware = createAuthMiddleware(deps.authenticator);
  const adminAuthMiddleware = createAdminAuthMiddleware(deps.authenticator);
  const scheduleExecutionAuthMiddleware = createApiKeyAuthMiddleware(configuration.TRUEFORGE_API_KEY);
  const authEnabled = getTrueForgeAuthMode() !== TrueForgeAuthMode.Standalone;
  const resolveHttpAgentStore = (c: Context) => deps.resolveAgentStore(resolveRequestContext(c));
  const httpMetrics = createHttpMetrics();
  app.use('*', createRequestLogContextMiddleware());
  app.use('/api/v1/sessions/:session_id/*', createSessionPathLogContextMiddleware());
  app.use('/api/v1/sessions/:session_id/turns/:turn_id/*', createSessionPathLogContextMiddleware());
  // Health, the scrape endpoint, and static files sit outside /api, so they never enter this middleware.
  app.use('/api/*', httpMetrics.middleware);
  if (configuration.ACCESS_LOGS) {
    app.use('*', createAccessLogMiddleware(deps.logger));
  }
  if (!configuration.STANDALONE && configuration.MTLS_ENABLED) {
    app.use('*', createClientCertificateMiddleware(deps.logger));
  }
  app.use('*', createRequestBodyLimitMiddleware(configuration.MAX_REQUEST_BODY_BYTES));
  app.get('/healthz', c => c.json({ status: 'ok', version: PACKAGE_VERSION }));
  app.get('/metrics', httpMetrics.handler);
  app.route(
    '/api/v1/auth',
    createAuthRouter({
      oidcClient: deps.oidcClient,
      logger: deps.logger,
      authMiddleware,
    }),
  );
  app.route(
    '/api/v1/capabilities',
    withAuth(
      createCapabilitiesRouter({
        sandboxEnvironmentStore: deps.sandboxEnvironmentStore,
        webSearchProviderStore: deps.webSearchProviderStore,
        withTransaction: deps.withTransaction,
        logger: deps.logger,
        resolveRequestContext,
      }),
      authMiddleware,
    ),
  );
  app.route(
    '/api/v1/models',
    withAuth(
      createModelsRouter({
        resolveModelProviderStore: c => deps.resolveModelProviderStore({ c }),
        withTransaction: deps.withTransaction,
        resolveRequestContext,
      }),
      authMiddleware,
    ),
  );
  app.route(
    '/api/v1/catalogs',
    withAuth(
      createCatalogRouter({
        modelCatalog: deps.modelCatalog,
        mcpCatalog: deps.mcpCatalog,
        skillCatalog: deps.skillCatalog,
        sandboxCatalog: deps.sandboxCatalog,
        webSearchCatalog: deps.webSearchCatalog,
      }),
      authMiddleware,
    ),
  );
  // Public MCP OAuth callbacks (local DCR + TrueFoundry/SFY) must be registered before the gated
  // `/mcp-servers` mount so `withAuth` cannot intercept IdP redirects to `/api/v1/mcp-servers/oauth/*`.
  app.route(
    '/api/v1/mcp-servers/oauth',
    createMcpOAuthRouter({
      tokenStore: deps.tokenStore,
      mcpServerStore: deps.resolveMcpServerStore({}),
      logger: deps.logger,
      resolveSession: c => tryAuthenticate({ authenticator: deps.authenticator, context: c }),
    }),
  );
  app.route(
    '/api/v1/mcp-servers',
    withAuth(
      createMcpServersRouter({
        resolveMcpServerStore: c => deps.resolveMcpServerStore({ c }),
        tokenStore: deps.tokenStore,
        withTransaction: deps.withTransaction,
        logger: deps.logger,
        resolveRequestContext,
      }),
      authMiddleware,
    ),
  );
  app.route(
    '/api/v1/skills',
    withAuth(
      createAvailableSkillsRouter({
        resolveSkillStore: c => deps.resolveSkillStore({ c }),
        withTransaction: deps.withTransaction,
        resolveRequestContext,
      }),
      authMiddleware,
    ),
  );
  app.route(
    '/api/v1/agents',
    withAuth(
      createAgentsRouter({
        resolveAgentStore: resolveHttpAgentStore,
        resolveModelProviderStore: c => deps.resolveModelProviderStore({ c }),
        resolveMcpServerStore: c => deps.resolveMcpServerStore({ c }),
        resolveSkillStore: c => deps.resolveSkillStore({ c }),
        sandboxProviderStore: deps.sandboxProviderStore,
        sandboxEnvironmentStore: deps.sandboxEnvironmentStore,
        webSearchProviderStore: deps.webSearchProviderStore,
        withTransaction: deps.withTransaction,
        resolveRequestContext,
        authorizer: deps.authorizer,
      }),
      authMiddleware,
    ),
  );
  app.route(
    '/api/v1/sandbox-environments',
    withAuth(
      createSandboxEnvironmentsRouter({
        sandboxEnvironmentStore: deps.sandboxEnvironmentStore,
        resolveAgentStore: resolveHttpAgentStore,
        sandboxProviderStore: deps.sandboxProviderStore,
        resolveRequestContext,
        logger: deps.logger,
      }),
      authMiddleware,
    ),
  );
  const scheduleTurnExecutionRouterDeps = {
    activeTurns: deps.activeTurns,
    agentStore: deps.agentStore,
    eventSubscriptions: deps.eventSubscriptions,
    logger: deps.logger,
    resolveMcpServerStore: deps.resolveMcpServerStore,
    resolveModelProviderStore: deps.resolveModelProviderStore,
    resolveTurnSkillsStore: deps.resolveTurnSkillsStore,
    sandboxEnvironmentStore: deps.sandboxEnvironmentStore,
    sandboxProviderStore: deps.sandboxProviderStore,
    scheduleStore: deps.scheduleStore,
    sessions: deps.sessions,
    sessionStore: deps.sessionStore,
    webSearchProviderStore: deps.webSearchProviderStore,
  };
  app.route(
    '/api/internal/schedules',
    withAuth(createScheduleExecutionRouter(scheduleTurnExecutionRouterDeps), scheduleExecutionAuthMiddleware),
  );
  app.route(
    '/api/internal/sandbox-environments',
    withAuth(
      createSandboxEnvironmentBuildRouter({
        sandboxEnvironmentStore: deps.sandboxEnvironmentStore,
        sandboxProviderStore: deps.sandboxProviderStore,
        logger: deps.logger,
      }),
      scheduleExecutionAuthMiddleware,
    ),
  );
  app.route(
    '/api/v1/schedules',
    withAuth(
      createSchedulesRouter({
        ...scheduleTurnExecutionRouterDeps,
        authorizer: deps.authorizer,
        resolveAgentStore: resolveHttpAgentStore,
        resolveRequestContext,
        withTransaction: deps.withTransaction,
      }),
      authMiddleware,
    ),
  );
  app.route(
    '/api/v1/settings',
    withAdminAuth(
      createSettingsRouter({
        resolveModelProviderStore: deps.resolveModelProviderStore,
        resolveMcpServerStore: deps.resolveMcpServerStore,
        tokenStore: deps.tokenStore,
        resolveSkillStore: c => deps.resolveSkillStore({ c }),
        sandboxProviderStore: deps.sandboxProviderStore,
        sandboxEnvironmentStore: deps.sandboxEnvironmentStore,
        webSearchProviderStore: deps.webSearchProviderStore,
        resolveAgentStore: resolveHttpAgentStore,
        withTransaction: deps.withTransaction,
        logger: deps.logger,
        resolveRequestContext,
      }),
      adminAuthMiddleware,
    ),
  );
  app.route(
    '/api/internal/sessions',
    withAuth(
      createInternalSessionsRouter({
        authorizer: deps.authorizer,
        resolveAgentStore: resolveHttpAgentStore,
        resolveMcpServerStore: deps.resolveMcpServerStore,
        resolveModelProviderStore: deps.resolveModelProviderStore,
        resolveRequestContext,
        resolveSkillStore: deps.resolveSkillStore,
        sandboxEnvironmentStore: deps.sandboxEnvironmentStore,
        sandboxProviderStore: deps.sandboxProviderStore,
        sessions: deps.sessions,
        webSearchProviderStore: deps.webSearchProviderStore,
      }),
      authMiddleware,
    ),
  );
  app.route(
    '/api/internal/metrics',
    withAuth(
      createInternalMetricsRouter({
        sessionMetricsStore: deps.sessionMetricsStore,
        resolveRequestContext,
        resolveAgentStore: resolveHttpAgentStore,
        authorizer: deps.authorizer,
      }),
      authMiddleware,
    ),
  );
  app.route(
    '/api/internal',
    withAuth(
      createPermissionsRouter({
        authorizer: deps.authorizer,
        resolveAgentStore: resolveHttpAgentStore,
        scheduleStore: deps.scheduleStore,
        sessionStore: deps.sessionStore,
        resolveRequestContext,
      }),
      authMiddleware,
    ),
  );
  app.route(
    '/api/v1/sessions',
    withAuth(
      createSessionsRouter({
        activeTurns: deps.activeTurns,
        authorizer: deps.authorizer,
        logger: deps.logger,
        redis: deps.redis,
        requestReplyRouter: deps.requestReplyRouter,
        resolveAgentStore: resolveHttpAgentStore,
        resolveMcpServerStore: deps.resolveMcpServerStore,
        resolveModelProviderStore: deps.resolveModelProviderStore,
        resolveRequestContext,
        resolveSkillStore: deps.resolveSkillStore,
        sandboxEnvironmentStore: deps.sandboxEnvironmentStore,
        sandboxProviderStore: deps.sandboxProviderStore,
        sessions: deps.sessions,
        sessionStore: deps.sessionStore,
        webSearchProviderStore: deps.webSearchProviderStore,
      }),
      authMiddleware,
    ),
  );
  app.route(
    '/api/v1/sessions',
    withAuth(
      createTurnsRouter({
        activeTurns: deps.activeTurns,
        authorizer: deps.authorizer,
        eventSubscriptions: deps.eventSubscriptions,
        logger: deps.logger,
        redis: deps.redis,
        requestReplyRouter: deps.requestReplyRouter,
        resolveAgentStore: deps.resolveAgentStore,
        resolveRequestContext,
        resolveTurnExecutionStores: deps.resolveTurnExecutionStores,
        sandboxEnvironmentStore: deps.sandboxEnvironmentStore,
        sandboxProviderStore: deps.sandboxProviderStore,
        sessions: deps.sessions,
        sessionStore: deps.sessionStore,
      }),
      authMiddleware,
    ),
  );

  const uiBasePath = getPublicUiBasePath();
  if (configuration.SWAGGER_ENABLED) {
    const openApiSpecPath = `${uiBasePath}api/v1/openapi.json`;
    const openApiServerUrl = uiBasePath === '/' ? undefined : uiBasePath.replace(/\/$/, '');
    app.get('/api/v1/docs', swaggerUI({ url: openApiSpecPath }));
    app.get('/api/v1/openapi.json', c =>
      c.json(
        buildOpenApiDocument(app, {
          authEnabled,
          ...(openApiServerUrl === undefined ? {} : { serverUrl: openApiServerUrl }),
        }),
      ),
    );
  }

  app.notFound(routeNotFound);

  app.onError(createAppErrorHandler({ logger: deps.logger }));

  return app;
}
