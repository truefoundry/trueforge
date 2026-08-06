import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { ModelCatalog } from '../catalog/ModelCatalog';
import type { IModelProviderStore } from '../db/modelProviderStore';
import {
  getModelProviderCatalogRoute,
  listModelProvidersRoute,
  putModelProviderRoute,
} from '../routes/modelProviderRoutes';
import { TENANT_ID } from './sessions';

export interface ModelProvidersRouterDeps {
  modelCatalog: ModelCatalog;
  modelProviderStore: IModelProviderStore;
}

export function createModelProvidersRouter(deps: ModelProvidersRouterDeps) {
  const catalogHandler: RouteHandler<typeof getModelProviderCatalogRoute> = c => {
    return c.json({ data: [...deps.modelCatalog.list()] }, 200);
  };

  const listHandler: RouteHandler<typeof listModelProvidersRoute> = async c => {
    const records = await deps.modelProviderStore.listProviders(TENANT_ID);
    return c.json({ data: records.map(record => record.manifest) }, 200);
  };

  const putHandler: RouteHandler<typeof putModelProviderRoute> = async c => {
    const record = await deps.modelProviderStore.upsertProvider({
      tenant_id: TENANT_ID,
      manifest: c.req.valid('json'),
    });
    return c.json({ data: record.manifest }, 200);
  };

  const router = new OpenAPIHono();
  router.openapi(getModelProviderCatalogRoute, catalogHandler);
  router.openapi(listModelProvidersRoute, listHandler);
  router.openapi(putModelProviderRoute, putHandler);
  return router;
}
