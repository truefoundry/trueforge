/** The API: resource routers, the OpenAPI document and Swagger UI, all under /api/v1. */
import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { ISessionStore, Sessions, TurnStreamingEvent } from '@truefoundry/utils-core/agent-session';
import type { IOAuthTokenStore, SandboxProvider } from '@truefoundry/utils-core/core';
import type { RequestReplyRouter } from '@truefoundry/utils-core/request-reply';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { RedisClientType } from 'redis';
import type { Logger } from 'winston';
import { createCapabilitiesRouter } from './apis/capabilities';
import { createMcpOAuthRouter } from './apis/mcpOAuth';
import { createAvailableMcpServersRouter } from './apis/mcpServers';
import { createModelsRouter } from './apis/models';
import { createSessionsRouter } from './apis/sessions';
import { createSettingsRouter } from './apis/settings';
import { createAvailableSkillsRouter } from './apis/skills';
import { createTurnsRouter } from './apis/turns';
import type { McpCatalog } from './catalog/McpCatalog';
import type { ModelCatalog } from './catalog/ModelCatalog';
import type { SandboxCatalog } from './catalog/SandboxCatalog';
import type { SkillCatalog } from './catalog/SkillCatalog';
import type { IMcpServerStore } from './db/mcpServerStore';
import type { IModelProviderStore } from './db/modelProviderStore';
import type { ISandboxProviderStore } from './db/sandboxProviderStore';
import type { ISkillStore } from './db/skillStore';
import type { ActiveTurnRegistry } from './runtime/activeTurns';
import type { EventSubscriptionRegistry } from './runtime/event-subscription';

const openApiDocConfig = {
  openapi: '3.1.0',
  info: {
    title: 'Agent Server',
    description: 'Agent server with DB-backed sessions, settings catalogs, and model/MCP/skill providers.',
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

export interface ServerDeps {
  modelCatalog: ModelCatalog;
  modelProviderStore: IModelProviderStore;
  mcpCatalog: McpCatalog;
  mcpServerStore: IMcpServerStore;
  tokenStore: IOAuthTokenStore;
  skillCatalog: SkillCatalog;
  skillStore: ISkillStore;
  sandboxCatalog: SandboxCatalog;
  sandboxProviderStore: ISandboxProviderStore;
  sessionStore: ISessionStore;
  sessions: Sessions;
  activeTurns: ActiveTurnRegistry;
  /** Shared SandboxProvider from SANDBOX_SETTINGS; undefined = sandbox unsupported. */
  sandboxProvider?: SandboxProvider;
  /** Primary Redis client (server-owned); undefined in single-binary mode. */
  redis?: RedisClientType | undefined;
  /** Request-reply dispatch table served by this replica's executor. */
  requestReplyRouter: RequestReplyRouter;
  /** Hands out each turn's resumable event stream to the create and subscribe handlers. */
  eventSubscriptions: EventSubscriptionRegistry<TurnStreamingEvent>;
  logger: Logger;
}

export function createServerApp(deps: ServerDeps) {
  const app = new OpenAPIHono();

  app.get('/healthz', c => c.text('OK!'));

  app.route('/api/v1/capabilities', createCapabilitiesRouter({ sandboxProviderStore: deps.sandboxProviderStore }));
  app.route('/api/v1/models', createModelsRouter(deps.modelProviderStore));
  app.route('/api/v1/mcp-servers', createAvailableMcpServersRouter(deps.mcpServerStore));
  // Shared OAuth callback — path must match MCP_OAUTH_CALLBACK_PATH in the harness package.
  app.route(
    '/api/v1/mcp-servers/oauth',
    createMcpOAuthRouter({
      tokenStore: deps.tokenStore,
      mcpServerStore: deps.mcpServerStore,
      logger: deps.logger,
    }),
  );
  app.route('/api/v1/skills', createAvailableSkillsRouter(deps.skillStore));
  app.route(
    '/api/v1/settings',
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
      logger: deps.logger,
    }),
  );
  app.route(
    '/api/v1/sessions',
    createSessionsRouter({
      sessions: deps.sessions,
      sessionStore: deps.sessionStore,
      activeTurns: deps.activeTurns,
      modelProviderStore: deps.modelProviderStore,
      mcpServerStore: deps.mcpServerStore,
      skillStore: deps.skillStore,
      sandboxSupported: deps.sandboxProvider !== undefined,
      redis: deps.redis,
      requestReplyRouter: deps.requestReplyRouter,
    }),
  );
  app.route(
    '/api/v1/sessions',
    createTurnsRouter({
      sessions: deps.sessions,
      sessionStore: deps.sessionStore,
      activeTurns: deps.activeTurns,
      modelProviderStore: deps.modelProviderStore,
      mcpServerStore: deps.mcpServerStore,
      tokenStore: deps.tokenStore,
      skillStore: deps.skillStore,
      eventSubscriptions: deps.eventSubscriptions,
      ...(deps.sandboxProvider ? { sandboxProvider: deps.sandboxProvider } : {}),
      logger: deps.logger,
    }),
  );

  app.get('/api/v1/docs', swaggerUI({ url: '/api/v1/openapi.json' }));
  app.get('/api/v1/openapi.json', c => c.json(buildOpenApiDocument(app)));

  app.notFound(routeNotFound);

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ error: { message: error.message } }, error.status);
    }
    deps.logger.error('Unhandled error', { message: error.message, stack: error.stack });
    return c.json({ error: { message: 'Internal server error' } }, 500);
  });

  return app;
}
