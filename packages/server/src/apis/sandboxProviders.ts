import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { SandboxCatalog } from '../catalog/SandboxCatalog';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import type { WithTransaction } from '../db/transaction';
import {
  getSandboxProviderCatalogRoute,
  getSandboxProviderRoute,
  putSandboxProviderRoute,
} from '../routes/sandboxProviderRoutes';
import type { SandboxProvider } from '../schemas/sandboxProvider';
import { TENANT_ID } from './sessions';

export interface SandboxProvidersRouterDeps<TTransaction> {
  sandboxCatalog: SandboxCatalog;
  sandboxProviderStore: ISandboxProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
}

/** Admin/settings sandbox provider surface (mounted at /api/v1/settings/sandbox-providers). */
export function createSandboxProvidersRouter<TTransaction>(deps: SandboxProvidersRouterDeps<TTransaction>) {
  const catalogHandler: RouteHandler<typeof getSandboxProviderCatalogRoute> = c => {
    return c.json({ data: [...deps.sandboxCatalog.list()] }, 200);
  };

  const getHandler: RouteHandler<typeof getSandboxProviderRoute> = async c => {
    const record = await deps.sandboxProviderStore.getSandboxProvider(TENANT_ID);
    if (record === undefined) {
      return c.json({ error: { message: 'No sandbox provider configured' } }, 404);
    }
    return c.json({ data: record.manifest }, 200);
  };

  const putHandler: RouteHandler<typeof putSandboxProviderRoute> = async c => {
    const manifest: SandboxProvider = c.req.valid('json');
    const record = await deps.sandboxProviderStore.upsertSandboxProvider({
      tenant_id: TENANT_ID,
      manifest,
    });
    return c.json({ data: record.manifest }, 200);
  };

  const router = new OpenAPIHono();
  router.openapi(getSandboxProviderCatalogRoute, catalogHandler);
  router.openapi(getSandboxProviderRoute, getHandler);
  router.openapi(putSandboxProviderRoute, putHandler);
  return router;
}
