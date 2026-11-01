import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { ResolveRequestContext } from '../auth/identity';
import type { ConfigurationRecord, IConfigurationStore } from '../db/configurationStore';
import { getSettingsRoute, patchSettingsRoute } from '../routes/configurationRoutes';
import {
  DEFAULT_SETTINGS_MANIFEST,
  type CreateOrUpdateSettings,
  type Settings,
  type SettingsManifest,
  type SettingsManifestPatch,
} from '../schemas/settings';

export interface ConfigurationRouterDeps {
  resolveConfigurationStore: (c: Context) => IConfigurationStore;
  resolveRequestContext: ResolveRequestContext;
}

function toSettings(record: ConfigurationRecord): Settings {
  return { manifest: record.manifest, updated_at: record.updated_at };
}

/**
 * Reading or updating materialises the row, so a tenant always has a stored
 * document after its first visit and callers never need a separate create.
 */
async function loadOrCreate({
  tenant_id,
  store,
}: {
  tenant_id: string;
  store: IConfigurationStore;
}): Promise<ConfigurationRecord> {
  const existing = await store.getConfiguration(tenant_id);
  if (existing !== undefined) {
    return existing;
  }
  return await store.upsertConfiguration({ tenant_id, manifest: DEFAULT_SETTINGS_MANIFEST });
}

/** Listed per switch so a new switch cannot be silently dropped from a patch. */
function applyPatch({ current, patch }: { current: SettingsManifest; patch: SettingsManifestPatch }): SettingsManifest {
  return { web_search: patch.web_search ?? current.web_search };
}

export function createConfigurationRouter(deps: ConfigurationRouterDeps) {
  const getHandler: RouteHandler<typeof getSettingsRoute> = async c => {
    const requestContext = deps.resolveRequestContext(c);
    const record = await loadOrCreate({
      tenant_id: requestContext.tenant_id,
      store: deps.resolveConfigurationStore(c),
    });
    return c.json({ data: toSettings(record) }, 200);
  };

  const patchHandler: RouteHandler<typeof patchSettingsRoute> = async c => {
    const body: CreateOrUpdateSettings = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);
    const store = deps.resolveConfigurationStore(c);
    const current = await loadOrCreate({ tenant_id: requestContext.tenant_id, store });
    const record = await store.upsertConfiguration({
      tenant_id: requestContext.tenant_id,
      manifest: applyPatch({ current: current.manifest, patch: body.manifest }),
    });
    return c.json({ data: toSettings(record) }, 200);
  };

  const router = new OpenAPIHono();
  router.openapi(getSettingsRoute, getHandler);
  router.openapi(patchSettingsRoute, patchHandler);
  return router;
}
