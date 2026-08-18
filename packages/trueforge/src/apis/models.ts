import { OpenAPIHono } from '@hono/zod-openapi';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { WithTransaction } from '../db/transaction';
import { listAvailableModelsRoute } from '../routes/modelRoutes';
import { TENANT_ID } from './sessions';

/** Chat slim list (mounted at /api/v1/models) — mirrors GET /api/v1/skills. */
export function createModelsRouter<TTransaction>(deps: {
  modelProviderStore: IModelProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
}) {
  const router = new OpenAPIHono();
  router.openapi(listAvailableModelsRoute, async c =>
    c.json({ data: await deps.modelProviderStore.listModels(TENANT_ID) }, 200),
  );
  return router;
}
