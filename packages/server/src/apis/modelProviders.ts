import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { SUPPORTED_REASONING_EFFORTS } from '@truefoundry/utils-core/core';
import type { ModelCatalog } from '../catalog/ModelCatalog';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { WithTransaction } from '../db/transaction';
import {
  getModelProviderCatalogRoute,
  listModelProvidersRoute,
  putModelProviderRoute,
} from '../routes/modelProviderRoutes';
import type { CatalogModelProvider } from '../schemas/modelCatalog';
import { modelProviderName } from '../schemas/modelProvider';
import { TENANT_ID } from './sessions';

export interface ModelProvidersRouterDeps<TTransaction> {
  modelCatalog: ModelCatalog;
  modelProviderStore: IModelProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
}

export function createModelProvidersRouter<TTransaction>(deps: ModelProvidersRouterDeps<TTransaction>) {
  const catalogHandler: RouteHandler<typeof getModelProviderCatalogRoute> = c => {
    const loadedProvidersCatalog = deps.modelCatalog.list();
    // make a copy of the loaded providers catalog and add the custom provider sentinel
    const providersCatalog: CatalogModelProvider[] = [...loadedProvidersCatalog];
    providersCatalog.push({
      type: 'custom',
      supported_reasoning_efforts: [...SUPPORTED_REASONING_EFFORTS],
    });
    return c.json({ data: providersCatalog }, 200);
  };

  const listHandler: RouteHandler<typeof listModelProvidersRoute> = async c => {
    const records = await deps.modelProviderStore.listProviders(TENANT_ID);
    return c.json({ data: records.map(record => record.manifest) }, 200);
  };

  const putHandler: RouteHandler<typeof putModelProviderRoute> = async c => {
    const provider = c.req.valid('json');
    const record = await deps.modelProviderStore.upsertProvider({
      tenant_id: TENANT_ID,
      name: modelProviderName(provider),
      manifest: provider,
    });
    return c.json({ data: record.manifest }, 200);
  };

  const router = new OpenAPIHono();
  router.openapi(getModelProviderCatalogRoute, catalogHandler);
  router.openapi(listModelProvidersRoute, listHandler);
  router.openapi(putModelProviderRoute, putHandler);
  return router;
}
