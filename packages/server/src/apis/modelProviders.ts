import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { ModelProviderNameConflictError, type IModelProviderStore } from '../db/modelProviderStore';
import type { WithTransaction } from '../db/transaction';
import {
  createModelProviderRoute,
  listModelProvidersRoute,
  putModelProviderRoute,
} from '../routes/modelProviderRoutes';
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

function resolveModelProviderManifestForWrite({
  incoming,
  existing,
}: {
  incoming: ModelProvider;
  existing: ModelProvider | undefined;
}): ModelProvider {
  if (incoming.auth === undefined) {
    return incoming;
  }
  return {
    ...incoming,
    auth: {
      api_key: resolveStoredSecretValue({
        incoming: incoming.auth.api_key,
        existing: existing?.auth?.api_key,
      }),
    },
  };
}

export function createModelProvidersRouter<TTransaction>(deps: ModelProvidersRouterDeps<TTransaction>) {
  const listHandler: RouteHandler<typeof listModelProvidersRoute> = async c => {
    const records = await deps.modelProviderStore.listProviders(TENANT_ID);
    return c.json({ data: records.map(record => redactModelProvider(record.manifest)) }, 200);
  };

  const createHandler: RouteHandler<typeof createModelProviderRoute> = async c => {
    const provider = c.req.valid('json');
    const name = modelProviderName(provider);
    try {
      // Create has no prior row; redacted keep resolves to MissingStoredSecretError → 400.
      const manifest = resolveModelProviderManifestForWrite({ incoming: provider, existing: undefined });
      const record = await deps.modelProviderStore.createProvider({ tenant_id: TENANT_ID, name, manifest });
      return c.json({ data: redactModelProvider(record.manifest) }, 200);
    } catch (error) {
      if (error instanceof MissingStoredSecretError) {
        return c.json({ error: { message: 'API key is required' } }, 400);
      }
      if (error instanceof ModelProviderNameConflictError) {
        return c.json({ error: { message: error.message } }, 409);
      }
      throw error;
    }
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
        const manifest = resolveModelProviderManifestForWrite({
          incoming: provider,
          existing: existing?.manifest,
        });
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
  router.openapi(createModelProviderRoute, createHandler);
  router.openapi(putModelProviderRoute, putHandler);
  return router;
}
