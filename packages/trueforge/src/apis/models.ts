import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { ResolveRequestContext } from '../auth/identity';
import { getAutoModelRoutingForTenant, type IConfigurationStore } from '../db/configurationStore';
import type { IModelProviderStore, ModelInfo } from '../db/modelProviderStore';
import type { WithTransaction } from '../db/transaction';
import { listAvailableModelsRoute } from '../routes/modelRoutes';
import { describeAutoRouting } from '../runtime/autoModelRouting';
import type { AvailableModel } from '../schemas/modelProvider';

/** GET /models returns the picker fields plus Auto routing support, and omits cost. */
function toAvailableModel({
  model,
  enabledModelNames,
}: {
  model: ModelInfo;
  enabledModelNames: ReadonlySet<string>;
}): AvailableModel {
  return {
    name: model.name,
    model_id: model.model_id,
    provider: model.provider,
    properties: { ...model.properties, auto_routing: describeAutoRouting({ model, enabledModelNames }) },
    ...(model.canonicalModel === undefined ? {} : { canonical_model: model.canonicalModel }),
    ...(model.warning === undefined ? {} : { warning: model.warning }),
  };
}

/** Chat slim list (mounted at /api/v1/models) — mirrors GET /api/v1/skills. */
export function createModelsRouter<TTransaction>(deps: {
  resolveModelProviderStore: (c: Context) => IModelProviderStore<TTransaction>;
  configurationStore: IConfigurationStore;
  withTransaction: WithTransaction<TTransaction>;
  resolveRequestContext: ResolveRequestContext;
}) {
  const router = new OpenAPIHono();
  router.openapi(listAvailableModelsRoute, async c => {
    const store = deps.resolveModelProviderStore(c);
    const requestContext = deps.resolveRequestContext(c);
    const models = await store.listModels({ tenant_id: requestContext.tenant_id });
    const autoModelRouting = await getAutoModelRoutingForTenant({
      tenant_id: requestContext.tenant_id,
      store: deps.configurationStore,
    });
    const enabledModelNames = new Set(autoModelRouting.candidate_models);
    return c.json({ data: models.map(model => toAvailableModel({ model, enabledModelNames })) }, 200);
  });
  return router;
}
