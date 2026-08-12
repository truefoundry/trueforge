import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import type { WithTransaction } from '../db/transaction';
import { getSandboxProviderRoute, putSandboxProviderRoute } from '../routes/sandboxProviderRoutes';
import type { SandboxProvider } from '../schemas/sandboxProvider';
import { MissingStoredSecretError, resolveStoredSecretValue, toRedactedSecretValue } from '../utils/secretRedaction';
import { TENANT_ID } from './sessions';

export interface SandboxProvidersRouterDeps<TTransaction> {
  sandboxProviderStore: ISandboxProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
}

function redactSandboxProvider(manifest: SandboxProvider): SandboxProvider {
  return {
    ...manifest,
    auth: { api_key: toRedactedSecretValue(manifest.auth.api_key) },
  };
}

/** Admin/settings sandbox provider surface (mounted at /api/v1/settings/sandbox-providers). */
export function createSandboxProvidersRouter<TTransaction>(deps: SandboxProvidersRouterDeps<TTransaction>) {
  const getHandler: RouteHandler<typeof getSandboxProviderRoute> = async c => {
    const record = await deps.sandboxProviderStore.getSandboxProvider(TENANT_ID);
    if (record === undefined) {
      return c.json({ error: { message: 'No sandbox provider configured' } }, 404);
    }
    return c.json({ data: redactSandboxProvider(record.manifest) }, 200);
  };

  const putHandler: RouteHandler<typeof putSandboxProviderRoute> = async c => {
    const incoming: SandboxProvider = c.req.valid('json');
    try {
      const record = await deps.withTransaction(async transaction => {
        const existing = await deps.sandboxProviderStore.getSandboxProviderForUpdate(TENANT_ID, transaction);
        const manifest: SandboxProvider = {
          ...incoming,
          auth: {
            api_key: resolveStoredSecretValue({
              incoming: incoming.auth.api_key,
              existing: existing?.manifest.auth.api_key,
            }),
          },
        };
        return deps.sandboxProviderStore.upsertSandboxProvider({ tenant_id: TENANT_ID, manifest }, transaction);
      });
      return c.json({ data: redactSandboxProvider(record.manifest) }, 200);
    } catch (error) {
      if (error instanceof MissingStoredSecretError) {
        return c.json({ error: { message: 'API key is required' } }, 400);
      }
      throw error;
    }
  };

  const router = new OpenAPIHono();
  router.openapi(getSandboxProviderRoute, getHandler);
  router.openapi(putSandboxProviderRoute, putHandler);
  return router;
}
