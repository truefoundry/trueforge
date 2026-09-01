import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { WithTransaction } from '../db/transaction';
import { listAvailableModelsRoute } from '../routes/modelRoutes';
import { TENANT_ID } from './sessions';

/** Chat slim list (mounted at /api/v1/models) — mirrors GET /api/v1/skills. */
export function createModelsRouter<TTransaction>(deps: {
  resolveModelProviderStore: (c: Context) => IModelProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
}) {
  const router = new OpenAPIHono();
  router.openapi(listAvailableModelsRoute, async c => {
    const store = deps.resolveModelProviderStore(c);
    return c.json({ data: await store.listModels({ tenant_id: TENANT_ID }) }, 200);
  });
  return router;
}
