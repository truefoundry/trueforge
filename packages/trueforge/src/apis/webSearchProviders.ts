import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { ResolveRequestContext } from '../auth/identity';
import type { WithTransaction } from '../db/transaction';
import {
  WebSearchProviderNameConflictError,
  type IWebSearchProviderStore,
  type WebSearchProviderRecord,
} from '../db/webSearchProviderStore';
import {
  createWebSearchProviderRoute,
  listWebSearchProvidersRoute,
  putWebSearchProviderRoute,
} from '../routes/webSearchProviderRoutes';
import {
  webSearchProviderName,
  type ConfiguredWebSearchProvider,
  type CreateWebSearchProviderRequest,
  type UpdateWebSearchProviderRequest,
  type WebSearchProviderManifest,
} from '../schemas/webSearchProvider';
import { MissingStoredSecretError, resolveStoredSecretValue, toRedactedSecretValue } from '../utils/secretRedaction';

export interface WebSearchProvidersRouterDeps<TTransaction> {
  resolveWebSearchProviderStore: (c: Context) => IWebSearchProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  resolveRequestContext: ResolveRequestContext;
}

function redactWebSearchProvider(manifest: WebSearchProviderManifest): WebSearchProviderManifest {
  return {
    ...manifest,
    auth: { api_key: toRedactedSecretValue(manifest.auth.api_key) },
  };
}

function resolveWebSearchProviderManifestForWrite({
  incoming,
  existing,
}: {
  incoming: WebSearchProviderManifest;
  existing: WebSearchProviderManifest | undefined;
}): WebSearchProviderManifest {
  return {
    ...incoming,
    auth: {
      api_key: resolveStoredSecretValue({
        incoming: incoming.auth.api_key,
        existing: existing?.auth.api_key,
      }),
    },
  };
}

function toWireProvider(record: WebSearchProviderRecord): ConfiguredWebSearchProvider {
  return {
    name: record.name,
    manifest: redactWebSearchProvider(record.manifest),
  };
}

export function createWebSearchProvidersRouter<TTransaction>(deps: WebSearchProvidersRouterDeps<TTransaction>) {
  const listHandler: RouteHandler<typeof listWebSearchProvidersRoute> = async c => {
    const requestContext = deps.resolveRequestContext(c);
    const records = await deps.resolveWebSearchProviderStore(c).listProviders({ tenant_id: requestContext.tenant_id });
    return c.json({ data: records.map(toWireProvider) }, 200);
  };

  const createHandler: RouteHandler<typeof createWebSearchProviderRoute> = async c => {
    const body: CreateWebSearchProviderRequest = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);
    const provider = body.manifest;
    const name = webSearchProviderName(provider);
    try {
      const manifest = resolveWebSearchProviderManifestForWrite({ incoming: provider, existing: undefined });
      const record = await deps.resolveWebSearchProviderStore(c).createProvider({
        tenant_id: requestContext.tenant_id,
        name,
        manifest,
      });
      return c.json({ data: toWireProvider(record) }, 201);
    } catch (error) {
      if (error instanceof MissingStoredSecretError) {
        return c.json({ error: { message: 'API key is required' } }, 400);
      }
      if (error instanceof WebSearchProviderNameConflictError) {
        return c.json({ error: { message: error.message } }, 409);
      }
      throw error;
    }
  };

  const putHandler: RouteHandler<typeof putWebSearchProviderRoute> = async c => {
    const store = deps.resolveWebSearchProviderStore(c);
    const body: UpdateWebSearchProviderRequest = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);
    const provider = body.manifest;
    const name = webSearchProviderName(provider);
    try {
      const record = await deps.withTransaction(async transaction => {
        const existing = await store.getProviderForUpdate({ tenant_id: requestContext.tenant_id, name }, transaction);
        const manifest = resolveWebSearchProviderManifestForWrite({
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

  const router = new OpenAPIHono();
  router.openapi(listWebSearchProvidersRoute, listHandler);
  router.openapi(createWebSearchProviderRoute, createHandler);
  router.openapi(putWebSearchProviderRoute, putHandler);
  return router;
}
