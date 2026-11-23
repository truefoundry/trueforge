import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { ResolveRequestContext } from '../auth/identity';
import type { IModelProviderStore, ModelInfo } from '../db/modelProviderStore';
import type { WithTransaction } from '../db/transaction';
import { listAvailableModelsRoute } from '../routes/modelRoutes';
import type { AvailableModel } from '../schemas/modelProvider';

/** GET /models returns the picker fields and omits canonicalModel and cost. */
function toAvailableModel(model: ModelInfo): AvailableModel {
  return {
    name: model.name,
    model_id: model.model_id,
    provider: model.provider,
    properties: model.properties,
    ...(model.warning === undefined ? {} : { warning: model.warning }),
  };
}

/** Chat slim list (mounted at /api/v1/models) — mirrors GET /api/v1/skills. */
export function createModelsRouter<TTransaction>(deps: {
  resolveModelProviderStore: (c: Context) => IModelProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  resolveRequestContext: ResolveRequestContext;
}) {
  const router = new OpenAPIHono();
  router.openapi(listAvailableModelsRoute, async c => {
    const store = deps.resolveModelProviderStore(c);
    const requestContext = deps.resolveRequestContext(c);
    const models = await store.listModels({ tenant_id: requestContext.tenant_id });
    return c.json({ data: models.map(toAvailableModel) }, 200);
  });
  return router;
}
