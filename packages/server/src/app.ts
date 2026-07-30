/**
 * HTTP application: composes the resource routers and serves the OpenAPI
 * document (/openapi.json) and Swagger UI (/docs).
 */
import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { ISessionStore, Sessions, TurnSandboxFactory } from '@truefoundry/utils/agent-session';
import type { RequestReplyRouter } from '@truefoundry/utils/request-reply';
import { HTTPException } from 'hono/http-exception';
import type { RedisClientType } from 'redis';
import type { Logger } from 'winston';
import { createCapabilitiesRouter } from './apis/capabilities';
import { createMcpRouter } from './apis/mcp';
import { createModelsRouter } from './apis/models';
import { createSessionsRouter } from './apis/sessions';
import { createSkillsRouter } from './apis/skills';
import { createTurnsRouter } from './apis/turns';
import type { ActiveTurnRegistry } from './runtime/activeTurns';
import type { McpStore } from './store/McpStore';
import type { ModelStore } from './store/ModelStore';
import type { SkillStore } from './store/SkillStore';

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

export interface ServerDeps {
  modelStore: ModelStore;
  mcpStore: McpStore;
  skillStore: SkillStore;
  sessionStore: ISessionStore;
  sessions: Sessions;
  activeTurns: ActiveTurnRegistry;
  /** Built at boot from SANDBOX_SETTINGS; undefined = sandbox unsupported. */
  sandboxFactory?: TurnSandboxFactory;
  /** Primary Redis client (server-owned); carries executor peering. */
  redis: RedisClientType;
  /** Request-reply dispatch table served by this replica's executor. */
  requestReplyRouter: RequestReplyRouter;
  logger: Logger;
}

export function createServerApp(deps: ServerDeps) {
  const app = new OpenAPIHono();

  app.get('/', c => c.text('OK!'));

  app.route('/v1/capabilities', createCapabilitiesRouter({ sandboxEnabled: deps.sandboxFactory !== undefined }));
  app.route('/v1/models', createModelsRouter(deps.modelStore));
  app.route('/v1/mcp-servers', createMcpRouter({ mcpStore: deps.mcpStore, logger: deps.logger }));
  app.route('/v1/skills', createSkillsRouter(deps.skillStore));
  // Register turns router first before sessions router
  // We have a subtle bug in zod openapi generation
  // where calling .nullable() on a shared component pushes down the nullable inside the schema ref itself
  // that means we cannot reliably use T and T.nullable() in different schemas
  // e.g. ModelMessageEventSchema, in create turn sse response events union it is not nullable, but in the turn state done it can be nullable
  // if we place the turns router first then generator locks ModelMessageEventSchema first cleanly
  // and then reuses that ref in list events api  as anyOf {ModelMessageEventSchema, null}
  // TODO: remove this brittle reliance on ordering
  // instead we will do z.union([T, null]) eveywhere instead of T.nullable()
  app.route(
    '/v1/sessions',
    createTurnsRouter({
      sessions: deps.sessions,
      activeTurns: deps.activeTurns,
      modelStore: deps.modelStore,
      mcpStore: deps.mcpStore,
      ...(deps.sandboxFactory ? { sandboxFactory: deps.sandboxFactory } : {}),
      logger: deps.logger,
    }),
  );
  app.route(
    '/v1/sessions',
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

  app.get('/docs', swaggerUI({ url: '/openapi.json' }));
  app.get('/openapi.json', c => c.json(buildOpenApiDocument(app)));

  app.notFound(c => c.json({ error: { message: `Route not found: ${c.req.method} ${c.req.path}` } }, 404));

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ error: { message: error.message } }, error.status);
    }
    deps.logger.error('Unhandled error', { message: error.message, stack: error.stack });
    return c.json({ error: { message: 'Internal server error' } }, 500);
  });

  return app;
}
