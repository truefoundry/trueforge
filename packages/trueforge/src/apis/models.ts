import { OpenAPIHono } from '@hono/zod-openapi';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { WithTransaction } from '../db/transaction';
import { listModelsRoute } from '../routes/modelRoutes';
import { TENANT_ID } from './sessions';

/** FQN read view over configured model providers (mounted at /api/v1/models). */
export function createModelsRouter<TTransaction>(deps: {
  modelProviderStore: IModelProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
}) {
  const router = new OpenAPIHono();
  router.openapi(listModelsRoute, async c =>
    c.json({ data: await deps.modelProviderStore.listModels(TENANT_ID) }, 200),
  );
  return router;
}
