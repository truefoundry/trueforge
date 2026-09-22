import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { ResolveRequestContext } from '../auth/identity';
import type { IWebSearchProviderStore, WebSearchProviderRecord } from '../db/webSearchProviderStore';
import { getWebSearchProviderRoute, putWebSearchProviderRoute } from '../routes/webSearchProviderRoutes';
import {
  webSearchProviderName,
  type ConfiguredWebSearchProvider,
  type UpdateWebSearchProviderRequest,
  type WebSearchProviderManifest,
} from '../schemas/webSearchProvider';
import { MissingStoredSecretError, resolveStoredSecretValue, toRedactedSecretValue } from '../utils/secretRedaction';

export interface WebSearchProvidersRouterDeps {
  resolveWebSearchProviderStore: (c: Context) => IWebSearchProviderStore;
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
    name: webSearchProviderName(record.manifest),
    manifest: redactWebSearchProvider(record.manifest),
  };
}

export function createWebSearchProvidersRouter(deps: WebSearchProvidersRouterDeps) {
  const getHandler: RouteHandler<typeof getWebSearchProviderRoute> = async c => {
    const requestContext = deps.resolveRequestContext(c);
    const record = await deps.resolveWebSearchProviderStore(c).getProvider(requestContext.tenant_id);
    if (!record) {
      return c.json({ error: { message: 'No web search provider configured' } }, 404);
    }
    return c.json({ data: toWireProvider(record) }, 200);
  };

  const putHandler: RouteHandler<typeof putWebSearchProviderRoute> = async c => {
    const store = deps.resolveWebSearchProviderStore(c);
    const body: UpdateWebSearchProviderRequest = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);
    const provider = body.manifest;
    try {
      const existing = await store.getProvider(requestContext.tenant_id);
      const manifest = resolveWebSearchProviderManifestForWrite({
        incoming: provider,
        existing: existing?.manifest,
      });
      const record = await store.upsertProvider({ tenant_id: requestContext.tenant_id, manifest });
      return c.json({ data: toWireProvider(record) }, 200);
    } catch (error) {
      if (error instanceof MissingStoredSecretError) {
        return c.json({ error: { message: 'API key is required' } }, 400);
      }
      throw error;
    }
  };

  const router = new OpenAPIHono();
  router.openapi(getWebSearchProviderRoute, getHandler);
  router.openapi(putWebSearchProviderRoute, putHandler);
  return router;
}
