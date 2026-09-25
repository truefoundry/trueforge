import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { assertSafeOutboundUrl } from '@truefoundry/trueforge-core/core';
import type { Context } from 'hono';
import type { ResolveRequestContext } from '../auth/identity';
import type { IAgentStore } from '../db/agentStore';
import {
  ModelProviderNameConflictError,
  type IModelProviderStore,
  type ModelProviderRecord,
} from '../db/modelProviderStore';
import type { WithTransaction } from '../db/transaction';
import {
  createModelProviderRoute,
  deleteModelProviderRoute,
  listModelProvidersRoute,
  putModelProviderRoute,
} from '../routes/modelProviderRoutes';
import { findCatalogUsageConflict } from '../runtime/catalogUsage';
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
  resolveAgentStore: (c: Context) => IAgentStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  resolveRequestContext: ResolveRequestContext;
}

/** Fully-qualified names an upsert would drop, so agents pointing at them can be caught first. */
function droppedModelNames({
  provider_name,
  existing,
  incoming,
}: {
  provider_name: string;
  existing: ModelProviderManifest | undefined;
  incoming: ModelProviderManifest;
}): string[] {
  if (existing === undefined) {
    return [];
  }
  const kept = new Set(incoming.models.map(model => model.name));
  return existing.models.filter(model => !kept.has(model.name)).map(model => `${provider_name}/${model.name}`);
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
      await assertSafeOutboundUrl(provider.base_url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Outbound URL blocked';
      return c.json({ error: { message } }, 400);
    }
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
      await assertSafeOutboundUrl(provider.base_url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Outbound URL blocked';
      return c.json({ error: { message } }, 400);
    }
    try {
      // Lock → resolve secret from that snapshot → upsert, all in one txn so concurrent keep
      // cannot re-write a secret over a rotate that committed in between.
      const outcome = await deps.withTransaction(
        async (transaction): Promise<{ conflict: string } | { conflict: undefined; record: ModelProviderRecord }> => {
          const existing = await store.getProviderForUpdate({ tenant_id: requestContext.tenant_id, name }, transaction);
          const manifest = resolveModelProviderManifestForWrite({
            incoming: provider,
            existing: existing?.manifest,
          });
          const conflict = await findCatalogUsageConflict(
            {
              agentStore: deps.resolveAgentStore(c),
              tenant_id: requestContext.tenant_id,
              entity: 'model',
              names: droppedModelNames({ provider_name: name, existing: existing?.manifest, incoming: manifest }),
            },
            transaction,
          );
          if (conflict !== undefined) {
            return { conflict };
          }
          return {
            conflict: undefined,
            record: await store.upsertProvider({ tenant_id: requestContext.tenant_id, name, manifest }, transaction),
          };
        },
      );
      if (outcome.conflict !== undefined) {
        return c.json({ error: { message: outcome.conflict } }, 409);
      }
      return c.json({ data: toWireProvider(outcome.record) }, 200);
    } catch (error) {
      if (error instanceof MissingStoredSecretError) {
        return c.json({ error: { message: 'API key is required' } }, 400);
      }
      throw error;
    }
  };

  const deleteHandler: RouteHandler<typeof deleteModelProviderRoute> = async c => {
    const store = deps.resolveModelProviderStore(c);
    const { name } = c.req.valid('param');
    const requestContext = deps.resolveRequestContext(c);
    const outcome = await deps.withTransaction(async transaction => {
      const existing = await store.getProviderForUpdate({ tenant_id: requestContext.tenant_id, name }, transaction);
      if (existing === undefined) {
        return { deleted: false, conflict: undefined };
      }
      // Agents name a model, not a provider, so the provider itself is the reference to check.
      const conflict = await findCatalogUsageConflict(
        {
          agentStore: deps.resolveAgentStore(c),
          tenant_id: requestContext.tenant_id,
          entity: 'model_provider',
          names: [name],
        },
        transaction,
      );
      if (conflict !== undefined) {
        return { deleted: false, conflict };
      }
      const deleted = await store.deleteProvider({ tenant_id: requestContext.tenant_id, name }, transaction);
      return { deleted, conflict: undefined };
    });
    if (outcome.conflict !== undefined) {
      return c.json({ error: { message: outcome.conflict } }, 409);
    }
    if (!outcome.deleted) {
      return c.json({ error: { message: `Model provider not found: ${name}` } }, 404);
    }
    return c.json({}, 200);
  };

  const router = new OpenAPIHono();
  router.openapi(listModelProvidersRoute, listHandler);
  router.openapi(createModelProviderRoute, createHandler);
  router.openapi(putModelProviderRoute, putHandler);
  router.openapi(deleteModelProviderRoute, deleteHandler);
  return router;
}
