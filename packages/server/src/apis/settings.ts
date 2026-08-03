/**
 * Admin/settings API surface under /api/v1/settings.
 * Sub-routers (model-providers today; mcp/skills/sandbox later) mount here so
 * a single policy can wrap the whole tree later without touching each resource.
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import type { ModelCatalog } from '../catalog/ModelCatalog';
import type { IModelProviderStore } from '../db/modelProviderStore';
import { createModelProvidersRouter } from './modelProviders';

export interface SettingsRouterDeps {
  modelCatalog: ModelCatalog;
  modelProviderStore: IModelProviderStore;
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
  return router;
}
