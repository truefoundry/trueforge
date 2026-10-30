import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { ResolveRequestContext } from '../auth/identity';
import type { ITenantSettingStore } from '../db/tenantSettingStore';
import { getTenantSettingRoute, putTenantSettingRoute } from '../routes/tenantSettingRoutes';
import type { TenantSetting, UpdateTenantSettingRequest } from '../schemas/tenantSetting';
import { resolveTenantSettingManifest } from '../tenantSettings/tenantSettings';

export interface TenantSettingsRouterDeps {
  resolveTenantSettingStore: (c: Context) => ITenantSettingStore;
  resolveRequestContext: ResolveRequestContext;
}

export function createTenantSettingsRouter(deps: TenantSettingsRouterDeps) {
  const getHandler: RouteHandler<typeof getTenantSettingRoute> = async c => {
    const requestContext = deps.resolveRequestContext(c);
    const manifest = await resolveTenantSettingManifest({
      tenant_id: requestContext.tenant_id,
      store: deps.resolveTenantSettingStore(c),
    });
    const data: TenantSetting = { manifest };
    return c.json({ data }, 200);
  };

  const putHandler: RouteHandler<typeof putTenantSettingRoute> = async c => {
    const body: UpdateTenantSettingRequest = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);
    const record = await deps.resolveTenantSettingStore(c).upsertTenantSetting({
      tenant_id: requestContext.tenant_id,
      manifest: body.manifest,
    });
    const data: TenantSetting = { manifest: record.manifest };
    return c.json({ data }, 200);
  };

  const router = new OpenAPIHono();
  router.openapi(getTenantSettingRoute, getHandler);
  router.openapi(putTenantSettingRoute, putHandler);
  return router;
}
