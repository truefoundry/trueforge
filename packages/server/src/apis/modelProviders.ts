import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { ModelCatalog } from '../catalog/ModelCatalog';
import type { IModelProviderStore, ModelProviderRecord } from '../db/modelProviderStore';
import {
  getModelProviderCatalogRoute,
  listModelProvidersRoute,
  putModelProviderRoute,
} from '../routes/modelProviderRoutes';
import { toModelProviderManifest, type ModelProvider } from '../schemas/modelProvider';
import { TENANT_ID } from './sessions';

export interface ModelProvidersRouterDeps {
  modelCatalog: ModelCatalog;
  modelProviderStore: IModelProviderStore;
}

/** Wire view of a stored provider: identity `name` plus persisted manifest. */
function toModelProvider(record: ModelProviderRecord): ModelProvider {
  return {
    ...record.manifest,
    name: record.name,
  };
}

export function createModelProvidersRouter(deps: ModelProvidersRouterDeps) {
  const catalogHandler: RouteHandler<typeof getModelProviderCatalogRoute> = c => {
    return c.json({ data: [...deps.modelCatalog.list()] }, 200);
  };

  const listHandler: RouteHandler<typeof listModelProvidersRoute> = async c => {
    const records = await deps.modelProviderStore.listProviders(TENANT_ID);
    return c.json({ data: records.map(toModelProvider) }, 200);
  };

  const putHandler: RouteHandler<typeof putModelProviderRoute> = async c => {
    const body = c.req.valid('json');
    const record = await deps.modelProviderStore.upsertProvider({
      tenant_id: TENANT_ID,
      name: body.name,
      manifest: toModelProviderManifest(body),
    });
    return c.json({ data: toModelProvider(record) }, 200);
  };

  const router = new OpenAPIHono();
  router.openapi(getModelProviderCatalogRoute, catalogHandler);
  router.openapi(listModelProvidersRoute, listHandler);
  router.openapi(putModelProviderRoute, putHandler);
  return router;
}
