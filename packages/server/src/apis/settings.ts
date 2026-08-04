/**
 * Admin/settings API surface under /api/v1/settings.
 * Sub-routers (model-providers, mcp-servers, skills, sandbox-providers) mount here so
 * a single policy can wrap the whole tree later without touching each resource.
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import type { IOAuthTokenStore } from '@truefoundry/utils/core';
import type { Logger } from 'winston';
import type { McpCatalog } from '../catalog/McpCatalog';
import type { ModelCatalog } from '../catalog/ModelCatalog';
import type { SandboxCatalog } from '../catalog/SandboxCatalog';
import type { SkillCatalog } from '../catalog/SkillCatalog';
import type { IMcpServerStore } from '../db/mcpServerStore';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import type { ISkillStore } from '../db/skillStore';
import { createMcpServersRouter } from './mcpServers';
import { createModelProvidersRouter } from './modelProviders';
import { createSandboxProvidersRouter } from './sandboxProviders';
import { createSkillsRouter } from './skills';

export interface SettingsRouterDeps {
  modelCatalog: ModelCatalog;
  modelProviderStore: IModelProviderStore;
  mcpCatalog: McpCatalog;
  mcpServerStore: IMcpServerStore;
  tokenStore: IOAuthTokenStore;
  skillCatalog: SkillCatalog;
  skillStore: ISkillStore;
  sandboxCatalog: SandboxCatalog;
  sandboxProviderStore: ISandboxProviderStore;
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
      tokenStore: deps.tokenStore,
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
  router.route(
    '/sandbox-providers',
    createSandboxProvidersRouter({
      sandboxCatalog: deps.sandboxCatalog,
      sandboxProviderStore: deps.sandboxProviderStore,
    }),
  );
  return router;
}
