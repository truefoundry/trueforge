/**
 * Admin/settings API surface under /api/v1/settings.
 * Sub-routers (model-providers, mcp-servers, skills; sandbox later) mount here so
 * a single policy can wrap the whole tree later without touching each resource.
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import type { Logger } from 'winston';
import type { McpCatalog } from '../catalog/McpCatalog';
import type { ModelCatalog } from '../catalog/ModelCatalog';
import type { SkillCatalog } from '../catalog/SkillCatalog';
import type { IMcpServerStore } from '../db/mcpServerStore';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { ISkillStore } from '../db/skillStore';
import { createMcpServersRouter } from './mcpServers';
import { createModelProvidersRouter } from './modelProviders';
import { createSkillsRouter } from './skills';

export interface SettingsRouterDeps {
  modelCatalog: ModelCatalog;
  modelProviderStore: IModelProviderStore;
  mcpCatalog: McpCatalog;
  mcpServerStore: IMcpServerStore;
  skillCatalog: SkillCatalog;
  skillStore: ISkillStore;
  logger: Logger;
}

export function createSettingsRouter(deps: SettingsRouterDeps) {
  const router = new OpenAPIHono();
  router.route(
    '/model-providers',
    createModelProvidersRouter({
      modelCatalog: deps.modelCatalog,
      modelProviderStore: deps.modelProviderStore,
    }),
  );
  router.route(
    '/mcp-servers',
    createMcpServersRouter({
      mcpCatalog: deps.mcpCatalog,
      mcpServerStore: deps.mcpServerStore,
      logger: deps.logger,
    }),
  );
  router.route(
    '/skills',
    createSkillsRouter({
      skillCatalog: deps.skillCatalog,
      skillStore: deps.skillStore,
    }),
  );
  return router;
}
