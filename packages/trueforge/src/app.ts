/** The API: resource routers, the OpenAPI document and Swagger UI, all under /api/v1. */
import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono, z } from '@hono/zod-openapi';
import type { ISessionStore, Sessions, TurnStreamingEvent } from '@truefoundry/trueforge-core/agent-session';
import { extractErrorLogFields } from '@truefoundry/trueforge-core/core';
import type { RequestReplyRouter } from '@truefoundry/trueforge-core/request-reply';
import type { Context, ErrorHandler, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import type { Configuration } from 'openid-client';
import type { RedisClientType } from 'redis';
import type { Logger } from 'winston';
import { createAgentsRouter } from './apis/agents';
import { createAuthRouter } from './apis/auth';
import { createCapabilitiesRouter } from './apis/capabilities';
import { createCatalogRouter } from './apis/catalog';
import { createMcpOAuthRouter } from './apis/mcpOAuth';
import { createMcpServersRouter } from './apis/mcpServers';
import { createModelsRouter } from './apis/models';
import { createSchedulesRouter } from './apis/schedules';
import { createInternalMetricsRouter } from './apis/sessionMetrics';
import { createInternalSessionsRouter, createSessionsRouter } from './apis/sessions';
import { createSettingsRouter } from './apis/settings';
import { createAvailableSkillsRouter } from './apis/skills';
import { createTurnsRouter } from './apis/turns';
import { resolveUserContext } from './auth/identity';
import { adminAuthMiddleware, authMiddleware } from './auth/middleware';
import type { McpCatalog } from './catalog/McpCatalog';
import type { ModelCatalog } from './catalog/ModelCatalog';
import type { SandboxCatalog } from './catalog/SandboxCatalog';
import type { SkillCatalog } from './catalog/SkillCatalog';
import configuration from './config';
import type { IAgentStore } from './db/agentStore';
import type { IMcpServerWithAuthStore } from './db/mcpServerStore';
import type { IModelProviderStore } from './db/modelProviderStore';
import type { ISandboxProviderStore } from './db/sandboxProviderStore';
import type { IScheduleStore } from './db/scheduleStore';
import type { ISessionMetricsStore } from './db/sessionMetricsStore';
import type { ISkillStore } from './db/skillStore';
import type { WithTransaction } from './db/transaction';
import type { IOAuthTokenStore } from './mcp/auth/types';
import { PACKAGE_VERSION } from './packageVersion';
import { OPENAPI_DOCUMENT_TAGS } from './routes/openapiTags';
import type { ActiveTurnRegistry } from './runtime/activeTurns';
import type { EventSubscriptionRegistry } from './runtime/event-subscription';
import { InvalidCronError } from './schemas/schedule';
import { zodErrorResponse, zodValidationHook } from './zodErrorResponse';

const BEARER_AUTH_SCHEME = 'BearerAuth';

/** One line per request: method, path, status, duration. Skips `/healthz`. */
export function createAccessLogMiddleware(logger: Logger): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now();
    await next();
    if (c.req.path === '/healthz') {
      return;
    }
    logger.info('request', {
      method: c.req.method,
      path: c.req.path,
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

export function createAppErrorHandler(params: { logger: Logger }): ErrorHandler {
  return (error, c) => {
    if (error instanceof z.ZodError) {
      return zodErrorResponse(c, error);
    }
    if (error instanceof InvalidCronError) {
      return c.json({ error: { message: error.message } }, 400);
    }
    if (error instanceof HTTPException) {
      if (error.status >= 500) {
        params.logger.error('Server API error', {
          status: error.status,
          ...extractErrorLogFields(error),
        });
      }
      return c.json({ error: { message: error.message } }, error.status);
    }
    params.logger.error('Unhandled error', extractErrorLogFields(error));
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
      '**Authentication:** Standalone deployments (no OIDC) accept requests without credentials — middleware ' +
      'stamps a local default user. When OIDC is configured, protected routes require a valid `id_token` cookie ' +
      'or `Authorization: Bearer` ID token. There is no built-in API-key scheme; ' +
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
      'ID token (`Authorization: Bearer <id_token>`). Required on protected routes. ' +
      'Browser sessions may use the HttpOnly `id_token` cookie instead.',
  });
}

/**
 * Single source for both the served document and the one the SDK is built from.
 * When `authEnabled`, advertises required Bearer auth on operations that inherit global security.
 */
export function buildOpenApiDocument(app: OpenAPIHono, options?: { authEnabled?: boolean }) {
  const authEnabled = options?.authEnabled ?? false;
  if (authEnabled) {
    registerOpenApiBearerAuth(app);
  }
  return app.getOpenAPI31Document({
    ...openApiDocConfig,
    ...(authEnabled ? { security: [{ [BEARER_AUTH_SCHEME]: [] }] } : {}),
  });
}

function routeNotFound(c: Context) {
  return c.json({ error: { message: `Route not found: ${c.req.method} ${c.req.path}` } }, 404);
}

/** Sub-app shell: `.use('*', authMiddleware)` then child routes — same as gateway routers. */
function withAuth(router: OpenAPIHono): OpenAPIHono {
  const shell = new OpenAPIHono();
  shell.use('*', authMiddleware);
  shell.route('/', router);
  return shell;
}

/** Admin-only routes: local admin when auth is disabled; with OIDC requires an authenticated admin. */
function withAdminAuth(router: OpenAPIHono): OpenAPIHono {
  const shell = new OpenAPIHono();
  shell.use('*', adminAuthMiddleware);
  shell.route('/', router);
  return shell;
}

export interface ServerDeps<TTransaction> {
  modelCatalog: ModelCatalog;
  mcpCatalog: McpCatalog;
  skillCatalog: SkillCatalog;
  sandboxCatalog: SandboxCatalog;
  /**
   * Per-request store: DB singleton, or a token-bound TrueFoundry store in TrueFoundry mode.
   * Called without a context (e.g. the scheduler) it returns the DB persistence store.
   */
  resolveModelProviderStore: (c?: Context) => IModelProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  mcpServerStore: IMcpServerWithAuthStore<TTransaction>;
  tokenStore: IOAuthTokenStore<TTransaction>;
  skillStore: ISkillStore<TTransaction>;
  sandboxProviderStore: ISandboxProviderStore<TTransaction>;
  agentStore: IAgentStore<TTransaction>;
  scheduleStore: IScheduleStore<TTransaction>;
  sessionStore: ISessionStore;
  sessionMetricsStore: ISessionMetricsStore;
  sessions: Sessions;
  activeTurns: ActiveTurnRegistry;
  /** Primary Redis client (server-owned); undefined in standalone mode. */
  redis?: RedisClientType | undefined;
  /** Request-reply dispatch table served by this replica's executor. */
  requestReplyRouter: RequestReplyRouter;
  /** Hands out each turn's resumable event stream to the create and subscribe handlers. */
  eventSubscriptions: EventSubscriptionRegistry<TurnStreamingEvent>;
  logger: Logger;
  /** Discovered openid-client configuration; undefined when browser login is disabled. */
  oidcClient: Configuration | undefined;
}

export function createServerApp<TTransaction>(deps: ServerDeps<TTransaction>) {
  const app = new OpenAPIHono({ defaultHook: zodValidationHook });
  const authEnabled = deps.oidcClient != null;

  if (configuration.ACCESS_LOGS) {
    app.use('*', createAccessLogMiddleware(deps.logger));
  }
  app.use('*', createRequestBodyLimitMiddleware(configuration.MAX_REQUEST_BODY_BYTES));

  app.get('/healthz', c => c.json({ status: 'ok', version: PACKAGE_VERSION }));

  app.route('/api/v1/auth', createAuthRouter({ oidcClient: deps.oidcClient, logger: deps.logger }));
  app.route(
    '/api/v1/capabilities',
    withAuth(
      createCapabilitiesRouter({
        sandboxProviderStore: deps.sandboxProviderStore,
        withTransaction: deps.withTransaction,
        logger: deps.logger,
      }),
    ),
  );
  app.route(
    '/api/v1/models',
    withAuth(
      createModelsRouter({
        resolveModelProviderStore: deps.resolveModelProviderStore,
        withTransaction: deps.withTransaction,
      }),
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
      }),
    ),
  );
  // Public MCP OAuth callback must be registered before the gated `/mcp-servers` mount so
  // `withAuth` cannot intercept IdP redirects to `/api/v1/mcp-servers/oauth/*`.
  app.route(
    '/api/v1/mcp-servers/oauth',
    createMcpOAuthRouter({
      tokenStore: deps.tokenStore,
      mcpServerStore: deps.mcpServerStore,
      logger: deps.logger,
    }),
  );
  app.route(
    '/api/v1/mcp-servers',
    withAuth(
      createMcpServersRouter({
        mcpServerStore: deps.mcpServerStore,
        tokenStore: deps.tokenStore,
        withTransaction: deps.withTransaction,
        logger: deps.logger,
        resolveUserContext,
      }),
    ),
  );
  app.route(
    '/api/v1/skills',
    withAuth(
      createAvailableSkillsRouter({
        skillStore: deps.skillStore,
        withTransaction: deps.withTransaction,
      }),
    ),
  );
  app.route(
    '/api/v1/agents',
    withAuth(
      createAgentsRouter({
        agentStore: deps.agentStore,
        resolveModelProviderStore: deps.resolveModelProviderStore,
        mcpServerStore: deps.mcpServerStore,
        skillStore: deps.skillStore,
        sandboxProviderStore: deps.sandboxProviderStore,
        withTransaction: deps.withTransaction,
      }),
    ),
  );
  app.route(
    '/api/v1/schedules',
    withAuth(
      createSchedulesRouter({
        scheduleStore: deps.scheduleStore,
        agentStore: deps.agentStore,
        sessions: deps.sessions,
        turnDeps: {
          activeTurns: deps.activeTurns,
          eventSubscriptions: deps.eventSubscriptions,
          modelProviderStore: deps.resolveModelProviderStore(),
          mcpServerStore: deps.mcpServerStore,
          tokenStore: deps.tokenStore,
          skillStore: deps.skillStore,
          agentStore: deps.agentStore,
          sandboxProviderStore: deps.sandboxProviderStore,
          logger: deps.logger,
        },
        withTransaction: deps.withTransaction,
        resolveUserContext,
      }),
    ),
  );
  app.route(
    '/api/v1/settings',
    withAdminAuth(
      createSettingsRouter({
        resolveModelProviderStore: deps.resolveModelProviderStore,
        mcpServerStore: deps.mcpServerStore,
        tokenStore: deps.tokenStore,
        skillStore: deps.skillStore,
        sandboxProviderStore: deps.sandboxProviderStore,
        withTransaction: deps.withTransaction,
        logger: deps.logger,
        resolveUserContext,
      }),
    ),
  );
  app.route(
    '/internal/sessions',
    withAuth(
      createInternalSessionsRouter({
        sessions: deps.sessions,
        resolveModelProviderStore: deps.resolveModelProviderStore,
        mcpServerStore: deps.mcpServerStore,
        skillStore: deps.skillStore,
        agentStore: deps.agentStore,
        sandboxProviderStore: deps.sandboxProviderStore,
        resolveUserContext,
      }),
    ),
  );
  app.route(
    '/internal/metrics',
    withAuth(
      createInternalMetricsRouter({
        sessionMetricsStore: deps.sessionMetricsStore,
        resolveUserContext,
      }),
    ),
  );
  app.route(
    '/api/v1/sessions',
    withAuth(
      createSessionsRouter({
        sessions: deps.sessions,
        sessionStore: deps.sessionStore,
        activeTurns: deps.activeTurns,
        resolveModelProviderStore: deps.resolveModelProviderStore,
        mcpServerStore: deps.mcpServerStore,
        skillStore: deps.skillStore,
        agentStore: deps.agentStore,
        sandboxProviderStore: deps.sandboxProviderStore,
        redis: deps.redis,
        requestReplyRouter: deps.requestReplyRouter,
        resolveUserContext: resolveUserContext,
        logger: deps.logger,
      }),
    ),
  );
  app.route(
    '/api/v1/sessions',
    withAuth(
      createTurnsRouter({
        sessions: deps.sessions,
        sessionStore: deps.sessionStore,
        activeTurns: deps.activeTurns,
        resolveModelProviderStore: deps.resolveModelProviderStore,
        mcpServerStore: deps.mcpServerStore,
        tokenStore: deps.tokenStore,
        skillStore: deps.skillStore,
        agentStore: deps.agentStore,
        eventSubscriptions: deps.eventSubscriptions,
        sandboxProviderStore: deps.sandboxProviderStore,
        logger: deps.logger,
        resolveUserContext: resolveUserContext,
      }),
    ),
  );

  app.get('/api/v1/docs', swaggerUI({ url: '/api/v1/openapi.json' }));
  app.get('/api/v1/openapi.json', c => c.json(buildOpenApiDocument(app, { authEnabled })));

  app.notFound(routeNotFound);

  app.onError(createAppErrorHandler({ logger: deps.logger }));

  return app;
}
