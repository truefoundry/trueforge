import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { ResolveRequestContext } from '../auth/identity';
import type { ConfigurationRecord, IConfigurationStore } from '../db/configurationStore';
import { getConfigurationsRoute, patchConfigurationsRoute } from '../routes/configurationsRoutes';
import {
  DEFAULT_CONFIGURATIONS_MANIFEST,
  type Configurations,
  type ConfigurationsManifest,
  type ConfigurationsManifestPatch,
  type UpdateConfigurationsRequest,
} from '../schemas/configurations';

export interface ConfigurationsRouterDeps {
  resolveConfigurationStore: (c: Context) => IConfigurationStore;
  resolveRequestContext: ResolveRequestContext;
}

function toConfigurations(record: ConfigurationRecord): Configurations {
  return { manifest: record.manifest, updated_at: record.updated_at };
}

/**
 * Reading or updating materialises the row, so a tenant always has a stored
 * document after its first visit and callers never need a separate create.
 * The store only inserts when nothing is saved, so a read never overwrites a
 * concurrent update.
 */
async function loadOrCreate({
  tenant_id,
  store,
}: {
  tenant_id: string;
  store: IConfigurationStore;
}): Promise<ConfigurationRecord> {
  return await store.getOrCreateConfiguration({
    tenant_id,
    default_manifest: DEFAULT_CONFIGURATIONS_MANIFEST,
  });
}

/** Listed per switch so a new switch cannot be silently dropped from a patch. */
function applyPatch({
  current,
  patch,
}: {
  current: ConfigurationsManifest;
  patch: ConfigurationsManifestPatch;
}): ConfigurationsManifest {
  return { web_search: patch.web_search ?? current.web_search };
}

export function createConfigurationsRouter(deps: ConfigurationsRouterDeps) {
  const getHandler: RouteHandler<typeof getConfigurationsRoute> = async c => {
    const requestContext = deps.resolveRequestContext(c);
    const record = await loadOrCreate({
      tenant_id: requestContext.tenant_id,
      store: deps.resolveConfigurationStore(c),
    });
    return c.json({ data: toConfigurations(record) }, 200);
  };

  const patchHandler: RouteHandler<typeof patchConfigurationsRoute> = async c => {
    const body: UpdateConfigurationsRequest = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);
    const store = deps.resolveConfigurationStore(c);
    const current = await loadOrCreate({ tenant_id: requestContext.tenant_id, store });
    const record = await store.upsertConfiguration({
      tenant_id: requestContext.tenant_id,
      manifest: applyPatch({ current: current.manifest, patch: body.manifest }),
    });
    return c.json({ data: toConfigurations(record) }, 200);
  };

  const router = new OpenAPIHono();
  router.openapi(getConfigurationsRoute, getHandler);
  router.openapi(patchConfigurationsRoute, patchHandler);
  return router;
}
