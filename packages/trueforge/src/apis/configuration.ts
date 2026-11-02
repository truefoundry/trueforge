import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { ResolveRequestContext } from '../auth/identity';
import type { ConfigurationRecord, IConfigurationStore } from '../db/configurationStore';
import { getConfigurationRoute, patchConfigurationRoute } from '../routes/configurationRoutes';
import {
  DEFAULT_CONFIGURATION_MANIFEST,
  type Configuration,
  type ConfigurationManifest,
  type ConfigurationManifestPatch,
  type UpdateConfigurationRequest,
} from '../schemas/configuration';

export interface ConfigurationRouterDeps {
  resolveConfigurationStore: (c: Context) => IConfigurationStore;
  resolveRequestContext: ResolveRequestContext;
}

function toConfiguration(record: ConfigurationRecord): Configuration {
  return { manifest: record.manifest, updated_at: record.updated_at };
}

/** Listed per switch so a new switch cannot be silently dropped from a patch. */
function applyPatch({
  current,
  patch,
}: {
  current: ConfigurationManifest;
  patch: ConfigurationManifestPatch;
}): ConfigurationManifest {
  return { web_search: patch.web_search ?? current.web_search };
}

export function createConfigurationRouter(deps: ConfigurationRouterDeps) {
  const getHandler: RouteHandler<typeof getConfigurationRoute> = async c => {
    const requestContext = deps.resolveRequestContext(c);
    // Reading materialises the row, so a tenant always has a stored document after
    // its first visit. The store only inserts when nothing is saved.
    const record = await deps.resolveConfigurationStore(c).getOrCreateConfiguration({
      tenant_id: requestContext.tenant_id,
      default_manifest: DEFAULT_CONFIGURATION_MANIFEST,
    });
    return c.json({ data: toConfiguration(record) }, 200);
  };

  const patchHandler: RouteHandler<typeof patchConfigurationRoute> = async c => {
    const body: UpdateConfigurationRequest = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);
    const store = deps.resolveConfigurationStore(c);
    const current = await store.getOrCreateConfiguration({
      tenant_id: requestContext.tenant_id,
      default_manifest: DEFAULT_CONFIGURATION_MANIFEST,
    });
    const record = await store.upsertConfiguration({
      tenant_id: requestContext.tenant_id,
      manifest: applyPatch({ current: current.manifest, patch: body.manifest }),
    });
    return c.json({ data: toConfiguration(record) }, 200);
  };

  const router = new OpenAPIHono();
  router.openapi(getConfigurationRoute, getHandler);
  router.openapi(patchConfigurationRoute, patchHandler);
  return router;
}
