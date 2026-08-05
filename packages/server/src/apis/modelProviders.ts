import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import type { ModelCatalog } from '../catalog/ModelCatalog';
import type { IModelProviderStore, ModelProviderRecord } from '../db/modelProviderStore';
import {
  getModelProviderCatalogRoute,
  listModelProvidersRoute,
  putModelProviderRoute,
} from '../routes/modelProviderRoutes';
import { isWellKnownProviderType, toModelProviderManifest, type ModelProvider } from '../schemas/modelProvider';
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
    // The upsert is keyed by `name`, so a same-name write is an update and stays allowed.
    if (isWellKnownProviderType(body.type)) {
      const records = await deps.modelProviderStore.listProviders(TENANT_ID);
      const configured = records.find(record => record.manifest.type === body.type && record.name !== body.name);
      if (configured !== undefined) {
        throw new HTTPException(409, {
          message:
            `A "${body.type}" provider is already configured as "${configured.name}". Only one provider ` +
            `per well-known type is supported — update "${configured.name}" instead of adding another.`,
        });
      }
    }
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
