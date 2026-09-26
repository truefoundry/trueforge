import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { assertSafeOutboundUrl } from '@truefoundry/trueforge-core/core';
import type { Context } from 'hono';
import type { Logger } from 'winston';
import type { ResolveRequestContext } from '../auth/identity';
import {
  ModelProviderNameConflictError,
  type IModelProviderStore,
  type ModelProviderRecord,
} from '../db/modelProviderStore';
import type { WithTransaction } from '../db/transaction';
import { expandOpenCodeGoModels, fetchOpenCodeGoModelIds } from '../modelProvider/modelDiscovery';
import {
  createModelProviderRoute,
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
import {
  isRedactedSecretValue,
  MissingStoredSecretError,
  resolveStoredSecretValue,
  toRedactedSecretValue,
} from '../utils/secretRedaction';

export interface ModelProvidersRouterDeps<TTransaction> {
  resolveModelProviderStore: (c: Context) => IModelProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  resolveRequestContext: ResolveRequestContext;
  /** For surfacing upstream model-discovery failures. */
  logger?: Logger;
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

/**
 * OpenCode Go publishes its live model roster at `GET {base_url}/models`. Refresh it on every
 * save so the configured manifest tracks the provider instead of the shipped presets; failures
 * fall back to the incoming manifest and never fail the write.
 */
async function syncOpenCodeGoModels(
  manifest: ModelProviderManifest,
  apiKey: string | undefined,
  logger: Logger | undefined,
): Promise<ModelProviderManifest> {
  if (manifest.type !== 'opencode-go') {
    return manifest;
  }
  const discoveredIds = await fetchOpenCodeGoModelIds({ baseUrl: manifest.base_url, apiKey, logger });
  return expandOpenCodeGoModels(manifest, discoveredIds);
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
      await assertSafeOutboundUrl(provider.base_url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Outbound URL blocked';
      return c.json({ error: { message } }, 400);
    }
    try {
      // Create has no prior row; redacted keep resolves to MissingStoredSecretError → 400.
      const manifest = resolveModelProviderManifestForWrite({ incoming: provider, existing: undefined });
      const expanded = await syncOpenCodeGoModels(manifest, manifest.auth?.api_key, deps.logger);
      const record = await deps.resolveModelProviderStore(c).createProvider({
        tenant_id: requestContext.tenant_id,
        name,
        manifest: expanded,
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
      await assertSafeOutboundUrl(provider.base_url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Outbound URL blocked';
      return c.json({ error: { message } }, 400);
    }
    try {
      // OpenCode Go syncs its roster before the write; the redaction-aware store keeps the stored
      // key, so recover it via a plain read (the write path below re-locks the row itself).
      let expanded = provider;
      if (provider.type === 'opencode-go') {
        const incomingKey = provider.auth?.api_key;
        const discoveryKey =
          incomingKey === undefined || isRedactedSecretValue(incomingKey)
            ? (await store.getProvider({ tenant_id: requestContext.tenant_id, name, model_name: '' }))?.manifest.auth
                ?.api_key
            : incomingKey;
        expanded = await syncOpenCodeGoModels(provider, discoveryKey, deps.logger);
      }
      // Lock → resolve secret from that snapshot → upsert, all in one txn so concurrent keep
      // cannot re-write a secret over a rotate that committed in between.
      const record = await deps.withTransaction(async transaction => {
        const existing = await store.getProviderForUpdate({ tenant_id: requestContext.tenant_id, name }, transaction);
        const manifest = resolveModelProviderManifestForWrite({
          incoming: expanded,
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

  const router = new OpenAPIHono();
  router.openapi(listModelProvidersRoute, listHandler);
  router.openapi(createModelProviderRoute, createHandler);
  router.openapi(putModelProviderRoute, putHandler);
  return router;
}
