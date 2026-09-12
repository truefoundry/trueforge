import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { ResolveRequestContext } from '../auth/identity';
import {
  ModelProviderNameConflictError,
  type IModelProviderStore,
  type ModelProviderRecord,
} from '../db/modelProviderStore';
import type { WithTransaction } from '../db/transaction';
import {
  ModelDiscoveryError,
  ModelDiscoveryUnsupportedError,
  discoverProviderModels,
} from '../modelDiscovery/discoverProviderModels';
import {
  createModelProviderRoute,
  listDiscoveredModelsRoute,
  listModelProvidersRoute,
  putModelProviderRoute,
} from '../routes/modelProviderRoutes';
import {
  modelProviderName,
  type ConfiguredModelProvider,
  type CreateModelProviderRequest,
  type ModelProviderManifest,
  type UpdateModelProviderRequest,
} from '../schemas/modelProvider';
import { MissingStoredSecretError, resolveStoredSecretValue, toRedactedSecretValue } from '../utils/secretRedaction';

export interface ModelProvidersRouterDeps<TTransaction> {
  resolveModelProviderStore: (c: Context) => IModelProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  resolveRequestContext: ResolveRequestContext;
}

function redactModelProvider(manifest: ModelProviderManifest): ModelProviderManifest {
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
  incoming: ModelProviderManifest;
  existing: ModelProviderManifest | undefined;
}): ModelProviderManifest {
  if (!('auth' in incoming) || incoming.auth === undefined) {
    return incoming;
  }
  const existingApiKey = existing && 'auth' in existing ? existing.auth?.api_key : undefined;
  return {
    ...incoming,
    auth: {
      api_key: resolveStoredSecretValue({
        incoming: incoming.auth.api_key,
        existing: existingApiKey,
      }),
    },
  };
}

function toWireProvider(record: ModelProviderRecord): ConfiguredModelProvider {
  return {
    name: record.name,
    manifest: redactModelProvider(record.manifest),
  };
}

export function createModelProvidersRouter<TTransaction>(deps: ModelProvidersRouterDeps<TTransaction>) {
  const listHandler: RouteHandler<typeof listModelProvidersRoute> = async c => {
    const requestContext = deps.resolveRequestContext(c);
    const records = await deps.resolveModelProviderStore(c).listProviders({ tenant_id: requestContext.tenant_id });
    return c.json({ data: records.map(toWireProvider) }, 200);
  };

  const createHandler: RouteHandler<typeof createModelProviderRoute> = async c => {
    const body: CreateModelProviderRequest = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);
    const provider = body.manifest;
    const name = modelProviderName(provider);
    try {
      // Create has no prior row; redacted keep resolves to MissingStoredSecretError → 400.
      const manifest = resolveModelProviderManifestForWrite({ incoming: provider, existing: undefined });
      const record = await deps.resolveModelProviderStore(c).createProvider({
        tenant_id: requestContext.tenant_id,
        name,
        manifest,
      });
      return c.json({ data: toWireProvider(record) }, 201);
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
    const store = deps.resolveModelProviderStore(c);
    const body: UpdateModelProviderRequest = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);
    const provider = body.manifest;
    const name = modelProviderName(provider);
    try {
      // Lock → resolve secret from that snapshot → upsert, all in one txn so concurrent keep
      // cannot re-write a secret over a rotate that committed in between.
      const record = await deps.withTransaction(async transaction => {
        const existing = await store.getProviderForUpdate({ tenant_id: requestContext.tenant_id, name }, transaction);
        const manifest = resolveModelProviderManifestForWrite({
          incoming: provider,
          existing: existing?.manifest,
        });
        return store.upsertProvider({ tenant_id: requestContext.tenant_id, name, manifest }, transaction);
      });
      return c.json({ data: toWireProvider(record) }, 200);
    } catch (error) {
      if (error instanceof MissingStoredSecretError) {
        return c.json({ error: { message: 'API key is required' } }, 400);
      }
      throw error;
    }
  };

  const listDiscoveredModelsHandler: RouteHandler<typeof listDiscoveredModelsRoute> = async c => {
    const { name } = c.req.valid('param');
    const requestContext = deps.resolveRequestContext(c);
    // getProvider is model-scoped; discovery is about the provider row itself.
    const records = await deps.resolveModelProviderStore(c).listProviders({ tenant_id: requestContext.tenant_id });
    const record = records.find(candidate => candidate.name === name);
    if (record === undefined) {
      return c.json({ error: { message: `No model provider configured under "${name}"` } }, 404);
    }
    try {
      // The stored manifest carries the real key; nothing key-shaped comes from the request.
      const { models } = await discoverProviderModels(record.manifest);
      return c.json({ data: models }, 200);
    } catch (error) {
      if (error instanceof ModelDiscoveryUnsupportedError) {
        return c.json({ error: { message: error.message } }, 501);
      }
      if (error instanceof ModelDiscoveryError) {
        return c.json({ error: { message: error.message } }, 502);
      }
      throw error;
    }
  };

  const router = new OpenAPIHono();
  router.openapi(listModelProvidersRoute, listHandler);
  router.openapi(createModelProviderRoute, createHandler);
  router.openapi(putModelProviderRoute, putHandler);
  router.openapi(listDiscoveredModelsRoute, listDiscoveredModelsHandler);
  return router;
}
