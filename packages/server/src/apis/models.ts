import { OpenAPIHono } from '@hono/zod-openapi';
import type { IModelProviderStore } from '../db/modelProviderStore';
import { listModelsRoute, listOldModelsRoute } from '../routes/modelRoutes';
import type { ModelStore } from '../store/ModelStore';
import { TENANT_ID } from './sessions';

/** FQN read view over configured model providers (mounted at /api/v1/models). */
export function createModelsRouter(store: IModelProviderStore) {
  const router = new OpenAPIHono();
  router.openapi(listModelsRoute, async c => c.json({ data: await store.listModels(TENANT_ID) }, 200));
  return router;
}

/** YAML-backed flow the runtime still uses (mounted at /api/v1/old/models). */
export function createOldModelsRouter(store: ModelStore) {
  const router = new OpenAPIHono();
  router.openapi(listOldModelsRoute, c => c.json({ data: store.list() }, 200));
  return router;
}
