import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { WithTransaction } from '../db/transaction';
import { listModelProvidersRoute, putModelProviderRoute } from '../routes/modelProviderRoutes';
import { modelProviderName, type ModelProvider } from '../schemas/modelProvider';
import { MissingStoredSecretError, resolveStoredSecretValue, toRedactedSecretValue } from '../utils/secretRedaction';
import { TENANT_ID } from './sessions';

export interface ModelProvidersRouterDeps<TTransaction> {
  modelProviderStore: IModelProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
}

function redactModelProvider(manifest: ModelProvider): ModelProvider {
  if (manifest.auth === undefined) {
    return manifest;
  }
  return {
    ...manifest,
    auth: { api_key: toRedactedSecretValue(manifest.auth.api_key) },
  };
}

export function createModelProvidersRouter<TTransaction>(deps: ModelProvidersRouterDeps<TTransaction>) {
  const listHandler: RouteHandler<typeof listModelProvidersRoute> = async c => {
    const records = await deps.modelProviderStore.listProviders(TENANT_ID);
    return c.json({ data: records.map(record => redactModelProvider(record.manifest)) }, 200);
  };

  const putHandler: RouteHandler<typeof putModelProviderRoute> = async c => {
    const provider = c.req.valid('json');
    const name = modelProviderName(provider);
    try {
      // Lock → resolve secret from that snapshot → upsert, all in one txn so concurrent keep
      // cannot re-write a secret over a rotate that committed in between.
      const record = await deps.withTransaction(async transaction => {
        const existing = await deps.modelProviderStore.getProviderForUpdate(
          { tenant_id: TENANT_ID, name },
          transaction,
        );
        const manifest: ModelProvider =
          provider.auth === undefined
            ? provider
            : {
                ...provider,
                auth: {
                  api_key: resolveStoredSecretValue({
                    incoming: provider.auth.api_key,
                    existing: existing?.manifest.auth?.api_key,
                  }),
                },
              };
        return deps.modelProviderStore.upsertProvider({ tenant_id: TENANT_ID, name, manifest }, transaction);
      });
      return c.json({ data: redactModelProvider(record.manifest) }, 200);
    } catch (error) {
      if (error instanceof MissingStoredSecretError) {
        return c.json({ error: { message: 'API key is required' } }, 400);
      }
      throw error;
    }
  };

  const router = new OpenAPIHono();
  router.openapi(listModelProvidersRoute, listHandler);
  router.openapi(putModelProviderRoute, putHandler);
  return router;
}
