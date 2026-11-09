import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ResolveRequestContext } from '../auth/identity';
import type { IMemoryProviderStore, MemoryProviderRecord } from '../db/memoryProviderStore';
import { getMemoryProviderRoute, putMemoryProviderRoute } from '../routes/memoryProviderRoutes';
import {
  memoryProviderName,
  type ConfiguredMemoryProvider,
  type MemoryProviderManifest,
  type UpdateMemoryProviderRequest,
} from '../schemas/memoryProvider';
import { MissingStoredSecretError, resolveStoredSecretValue, toRedactedSecretValue } from '../utils/secretRedaction';

export interface MemoryProvidersRouterDeps {
  resolveMemoryProviderStore: (c: Context) => IMemoryProviderStore;
  resolveRequestContext: ResolveRequestContext;
}

function redactMemoryProvider(manifest: MemoryProviderManifest): MemoryProviderManifest {
  return {
    ...manifest,
    auth: { api_key: toRedactedSecretValue(manifest.auth.api_key) },
  };
}

function resolveMemoryProviderManifestForWrite({
  incoming,
  existing,
}: {
  incoming: MemoryProviderManifest;
  existing: MemoryProviderManifest | undefined;
}): MemoryProviderManifest {
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

function toWireProvider(record: MemoryProviderRecord): ConfiguredMemoryProvider {
  return {
    name: memoryProviderName(record.manifest),
    manifest: redactMemoryProvider(record.manifest),
  };
}

export function createMemoryProvidersRouter(deps: MemoryProvidersRouterDeps) {
  const getHandler: RouteHandler<typeof getMemoryProviderRoute> = async c => {
    const requestContext = deps.resolveRequestContext(c);
    const record = await deps.resolveMemoryProviderStore(c).getProvider(requestContext.tenant_id);
    if (!record) {
      return c.json({ error: { message: 'No memory provider configured' } }, 404);
    }
    return c.json({ data: toWireProvider(record) }, 200);
  };

  const putHandler: RouteHandler<typeof putMemoryProviderRoute> = async c => {
    const store = deps.resolveMemoryProviderStore(c);
    const body: UpdateMemoryProviderRequest = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);
    try {
      const existing = await store.getProvider(requestContext.tenant_id);
      const manifest = resolveMemoryProviderManifestForWrite({
        incoming: body.manifest,
        existing: existing?.manifest,
      });
      const record = await store.upsertProvider({ tenant_id: requestContext.tenant_id, manifest });
      return c.json({ data: toWireProvider(record) }, 200);
    } catch (error) {
      if (error instanceof MissingStoredSecretError) {
        throw new HTTPException(400, { message: 'API key is required', cause: error });
      }
      throw error;
    }
  };

  const router = new OpenAPIHono();
  router.openapi(getMemoryProviderRoute, getHandler);
  router.openapi(putMemoryProviderRoute, putHandler);
  return router;
}
