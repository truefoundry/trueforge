import { OpenAPIHono } from '@hono/zod-openapi';
import type { IModelProviderStore } from '../db/modelProviderStore';
import { listModelsRoute } from '../routes/modelRoutes';
import { TENANT_ID } from './sessions';

/** FQN read view over configured model providers (mounted at /api/v1/models). */
export function createModelsRouter(store: IModelProviderStore) {
  const router = new OpenAPIHono();
  router.openapi(listModelsRoute, async c => c.json({ data: await store.listModels(TENANT_ID) }, 200));
  return router;
}
