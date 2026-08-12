/**
 * Authenticated discovery catalogs under /api/v1/catalog.
 * Model-providers first; MCP / skills / sandbox catalogs stay under settings until moved.
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { SUPPORTED_REASONING_EFFORTS } from '@truefoundry/utils-core/core';
import type { ModelCatalog } from '../catalog/ModelCatalog';
import { listModelProviderCatalogRoute } from '../routes/catalogRoutes';
import type { CatalogModelProvider } from '../schemas/modelCatalog';

export interface CatalogRouterDeps {
  modelCatalog: ModelCatalog;
}

export function createCatalogRouter(deps: CatalogRouterDeps) {
  const listModelProvidersHandler: RouteHandler<typeof listModelProviderCatalogRoute> = c => {
    const providersCatalog: CatalogModelProvider[] = [...deps.modelCatalog.list()];
    providersCatalog.push({
      type: 'custom',
      supported_reasoning_efforts: [...SUPPORTED_REASONING_EFFORTS],
    });
    return c.json({ data: providersCatalog }, 200);
  };

  const router = new OpenAPIHono();
  router.openapi(listModelProviderCatalogRoute, listModelProvidersHandler);
  return router;
}
