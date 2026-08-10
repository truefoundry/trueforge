/** The API: resource routers, the OpenAPI document and Swagger UI, all under /api/v1. */
import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono, z } from '@hono/zod-openapi';
import type { ISessionStore, Sessions, TurnStreamingEvent } from '@truefoundry/utils-core/agent-session';
import type { RequestReplyRouter } from '@truefoundry/utils-core/request-reply';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Configuration } from 'openid-client';
import type { RedisClientType } from 'redis';
import type { Logger } from 'winston';
import { createAgentsRouter } from './apis/agents';
import { createAuthRouter } from './apis/auth';
import { createCapabilitiesRouter } from './apis/capabilities';
import { createMcpOAuthRouter } from './apis/mcpOAuth';
import { createMcpServersRouter } from './apis/mcpServers';
import { createModelsRouter } from './apis/models';
import { createSessionsRouter } from './apis/sessions';
import { createSettingsRouter } from './apis/settings';
import { createAvailableSkillsRouter } from './apis/skills';
import { createTurnsRouter } from './apis/turns';
import { resolveUserContext } from './auth/identity';
import { adminAuthMiddleware, authMiddleware } from './auth/middleware';
import type { McpCatalog } from './catalog/McpCatalog';
import type { ModelCatalog } from './catalog/ModelCatalog';
import type { SandboxCatalog } from './catalog/SandboxCatalog';
import type { SkillCatalog } from './catalog/SkillCatalog';
import type { IAgentStore } from './db/agentStore';
import type { IMcpServerStore } from './db/mcpServerStore';
import type { IModelProviderStore } from './db/modelProviderStore';
import type { ISandboxProviderStore } from './db/sandboxProviderStore';
import type { ISkillStore } from './db/skillStore';
import type { WithTransaction } from './db/transaction';
import type { IOAuthTokenStore } from './mcp/auth/types';
import type { ActiveTurnRegistry } from './runtime/activeTurns';
import type { EventSubscriptionRegistry } from './runtime/event-subscription';
import { zodErrorResponse, zodValidationHook } from './zodErrorResponse';

const openApiDocConfig = {
  openapi: '3.1.0',
  info: {
    title: 'TrueForge API',
    description:
      'HTTP API for the TrueForge agent server (`/api/v1`). Interactive docs are served at `/api/v1/docs` ' +
      '(OpenAPI JSON at `/api/v1/openapi.json`).\n\n' +
      '**Authentication:** Standalone deployments (no OIDC) accept requests without credentials — middleware ' +
      'stamps a local default user. When OIDC is configured, browser login sets an httpOnly `id_token` cookie; ' +
      'protected routes read that cookie (not `Authorization: Bearer`). There is no built-in API-key scheme; ' +
      'pass custom headers only if your reverse proxy or IdP layer requires them.\n\n' +
      'Covers DB-backed sessions, the agent registry, settings catalogs, and model/MCP/skill/sandbox providers.',
    version: '0.1.0',
  },
};

/** Single source for both the served document and the one the SDK is built from. */
export function buildOpenApiDocument(app: OpenAPIHono) {
  return app.getOpenAPI31Document(openApiDocConfig);
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

/** Admin-only routes: standalone passes through; with OIDC requires an authenticated admin. */
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
  modelProviderStore: IModelProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  mcpServerStore: IMcpServerStore<TTransaction>;
  tokenStore: IOAuthTokenStore<TTransaction>;
  skillStore: ISkillStore<TTransaction>;
  sandboxProviderStore: ISandboxProviderStore<TTransaction>;
  agentStore: IAgentStore<TTransaction>;
  sessionStore: ISessionStore;
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

  app.get('/healthz', c => c.text('OK!'));

  app.route('/api/v1/auth', createAuthRouter({ oidcClient: deps.oidcClient, logger: deps.logger }));
  app.route(
    '/api/v1/capabilities',
    withAuth(
      createCapabilitiesRouter({
        sandboxProviderStore: deps.sandboxProviderStore,
        withTransaction: deps.withTransaction,
      }),
    ),
  );
  app.route(
    '/api/v1/models',
    withAuth(
      createModelsRouter({
        modelProviderStore: deps.modelProviderStore,
        withTransaction: deps.withTransaction,
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
      withTransaction: deps.withTransaction,
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
        modelProviderStore: deps.modelProviderStore,
        mcpServerStore: deps.mcpServerStore,
        skillStore: deps.skillStore,
        sandboxProviderStore: deps.sandboxProviderStore,
        withTransaction: deps.withTransaction,
      }),
    ),
  );
  app.route(
    '/api/v1/settings',
    withAdminAuth(
      createSettingsRouter({
        modelCatalog: deps.modelCatalog,
        modelProviderStore: deps.modelProviderStore,
        mcpCatalog: deps.mcpCatalog,
        mcpServerStore: deps.mcpServerStore,
        tokenStore: deps.tokenStore,
        skillCatalog: deps.skillCatalog,
        skillStore: deps.skillStore,
        sandboxCatalog: deps.sandboxCatalog,
        sandboxProviderStore: deps.sandboxProviderStore,
        withTransaction: deps.withTransaction,
        logger: deps.logger,
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
        modelProviderStore: deps.modelProviderStore,
        mcpServerStore: deps.mcpServerStore,
        skillStore: deps.skillStore,
        agentStore: deps.agentStore,
        sandboxProviderStore: deps.sandboxProviderStore,
        redis: deps.redis,
        requestReplyRouter: deps.requestReplyRouter,
        resolveUserContext: resolveUserContext,
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
        modelProviderStore: deps.modelProviderStore,
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
  app.get('/api/v1/openapi.json', c => c.json(buildOpenApiDocument(app)));

  app.notFound(routeNotFound);

  app.onError((error, c) => {
    if (error instanceof z.ZodError) {
      return zodErrorResponse(c, error);
    }
    if (error instanceof HTTPException) {
      return c.json({ error: { message: error.message } }, error.status);
    }
    deps.logger.error('Unhandled error', { message: error.message, stack: error.stack });
    return c.json({ error: { message: 'Internal server error' } }, 500);
  });

  return app;
}
