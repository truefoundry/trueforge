/** The API: resource routers, the OpenAPI document and Swagger UI, all under /api/v1. */
import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { ISessionStore, Sessions, TurnSandboxFactory } from '@truefoundry/utils/agent-session';
import type { RequestReplyRouter } from '@truefoundry/utils/request-reply';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { RedisClientType } from 'redis';
import type { Logger } from 'winston';
import { createCapabilitiesRouter } from './apis/capabilities';
import { createLegacyMcpRouter } from './apis/legacyMcp';
import { createLegacyMcpOAuthRouter } from './apis/legacyMcpOAuth';
import { createLegacyModelsRouter } from './apis/legacyModels';
import { createLegacySkillsRouter } from './apis/legacySkills';
import { createAvailableMcpServersRouter } from './apis/mcpServers';
import { createModelsRouter } from './apis/models';
import { createSessionsRouter } from './apis/sessions';
import { createSettingsRouter } from './apis/settings';
import { createAvailableSkillsRouter } from './apis/skills';
import { createTurnsRouter } from './apis/turns';
import type { McpCatalog } from './catalog/McpCatalog';
import type { ModelCatalog } from './catalog/ModelCatalog';
import type { SkillCatalog } from './catalog/SkillCatalog';
import type { IMcpServerStore } from './db/mcpServerStore';
import type { IModelProviderStore } from './db/modelProviderStore';
import type { ISkillStore } from './db/skillStore';
import type { McpStore } from './legacy-registry-store/McpStore';
import type { ModelStore } from './legacy-registry-store/ModelStore';
import type { SkillStore } from './legacy-registry-store/SkillStore';
import type { ActiveTurnRegistry } from './runtime/activeTurns';

const openApiDocConfig = {
  openapi: '3.1.0',
  info: {
    title: 'Agent Server',
    description: 'Agent server exposing models, MCP servers and skills from local YAML config.',
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
  modelStore: ModelStore;
  modelCatalog: ModelCatalog;
  modelProviderStore: IModelProviderStore;
  mcpCatalog: McpCatalog;
  mcpServerStore: IMcpServerStore;
  mcpStore: McpStore;
  skillCatalog: SkillCatalog;
  skillStore: ISkillStore;
  legacySkillStore: SkillStore;
  sessionStore: ISessionStore;
  sessions: Sessions;
  activeTurns: ActiveTurnRegistry;
  /** Built at boot from SANDBOX_SETTINGS; undefined = sandbox unsupported. */
  sandboxFactory?: TurnSandboxFactory;
  /** Primary Redis client (server-owned); undefined in single-binary mode. */
  redis?: RedisClientType | undefined;
  /** Request-reply dispatch table served by this replica's executor. */
  requestReplyRouter: RequestReplyRouter;
  logger: Logger;
}

export function createServerApp(deps: ServerDeps) {
  const app = new OpenAPIHono();

  app.get('/healthz', c => c.text('OK!'));

  app.route('/api/v1/capabilities', createCapabilitiesRouter({ sandboxEnabled: deps.sandboxFactory !== undefined }));
  app.route('/api/v1/models', createModelsRouter(deps.modelProviderStore));
  app.route('/api/v1/mcp-servers', createAvailableMcpServersRouter(deps.mcpServerStore));
  app.route('/api/v1/skills', createAvailableSkillsRouter(deps.skillStore));
  app.route(
    '/api/v1/settings',
    createSettingsRouter({
      modelCatalog: deps.modelCatalog,
      modelProviderStore: deps.modelProviderStore,
      mcpCatalog: deps.mcpCatalog,
      mcpServerStore: deps.mcpServerStore,
      skillCatalog: deps.skillCatalog,
      skillStore: deps.skillStore,
      logger: deps.logger,
    }),
  );
  // YAML registry surfaces — still used by sessions/turns and the legacy UI paths.
  app.route('/api/v1/legacy/models', createLegacyModelsRouter(deps.modelStore));
  app.route('/api/v1/legacy/mcp-servers', createLegacyMcpRouter({ mcpStore: deps.mcpStore, logger: deps.logger }));
  app.route('/api/v1/legacy/mcp-servers/oauth', createLegacyMcpOAuthRouter({ logger: deps.logger }));
  app.route('/api/v1/legacy/skills', createLegacySkillsRouter(deps.legacySkillStore));
  app.route(
    '/api/v1/sessions',
    createSessionsRouter({
      sessions: deps.sessions,
      sessionStore: deps.sessionStore,
      activeTurns: deps.activeTurns,
      modelStore: deps.modelStore,
      mcpStore: deps.mcpStore,
      sandboxSupported: deps.sandboxFactory !== undefined,
      redis: deps.redis,
      requestReplyRouter: deps.requestReplyRouter,
    }),
  );
  app.route(
    '/api/v1/sessions',
    createTurnsRouter({
      sessions: deps.sessions,
      activeTurns: deps.activeTurns,
      modelStore: deps.modelStore,
      mcpStore: deps.mcpStore,
      ...(deps.sandboxFactory ? { sandboxFactory: deps.sandboxFactory } : {}),
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
