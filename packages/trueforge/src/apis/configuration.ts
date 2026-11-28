import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { ResolveRequestContext } from '../auth/identity';
import { enabledTenantModelRouting, trueFoundryModelRouting } from '../config';
import type { ConfigurationRecord, IConfigurationStore } from '../db/configurationStore';
import type { IModelProviderStore } from '../db/modelProviderStore';
import { getConfigurationRoute, patchConfigurationRoute } from '../routes/configurationRoutes';
import { validateAutoCandidateModels } from '../runtime/autoModelRouting';
import {
  DEFAULT_CONFIGURATION_MANIFEST,
  type AutoModelRoutingConfiguration,
  type AutoModelRoutingConfigurationPatch,
  type Configuration,
  type ConfigurationManifest,
  type ConfigurationManifestPatch,
  type UpdateConfigurationRequest,
} from '../schemas/configuration';

export interface ConfigurationRouterDeps {
  resolveConfigurationStore: (c: Context) => IConfigurationStore;
  /** The caller's models: an admin can only make Auto pick models they have access to. */
  resolveModelProviderStore: (c: Context) => IModelProviderStore;
  resolveRequestContext: ResolveRequestContext;
}

function toConfiguration(record: ConfigurationRecord): Configuration {
  return { manifest: record.manifest, updated_at: record.updated_at };
}

function applyAutoModelRoutingPatch({
  current,
  patch,
}: {
  current: AutoModelRoutingConfiguration;
  patch: AutoModelRoutingConfigurationPatch | undefined;
}): AutoModelRoutingConfiguration {
  if (patch === undefined) {
    return current;
  }
  return {
    enabled: patch.enabled ?? current.enabled,
    candidate_models: [...new Set(patch.candidate_models ?? current.candidate_models)],
  };
}

/** Listed per switch so a new switch cannot be silently dropped from a patch. */
function applyPatch({
  current,
  patch,
}: {
  current: ConfigurationManifest;
  patch: ConfigurationManifestPatch;
}): ConfigurationManifest {
  return {
    web_search: patch.web_search ?? current.web_search,
    memory: patch.memory ?? current.memory,
    auto_model_routing: applyAutoModelRoutingPatch({
      current: current.auto_model_routing,
      patch: patch.auto_model_routing,
    }),
  };
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
    const candidateModels = body.manifest.auto_model_routing?.candidate_models;
    if (candidateModels !== undefined) {
      if (enabledTenantModelRouting(trueFoundryModelRouting(), requestContext.tenant_id) === undefined) {
        return c.json({ error: { message: 'Model routing is not enabled for this tenant.' } }, 400);
      }
      const rejection = await validateAutoCandidateModels({
        names: candidateModels,
        tenant_id: requestContext.tenant_id,
        modelProviderStore: deps.resolveModelProviderStore(c),
      });
      if (rejection?.type === 'inaccessible') {
        return c.json(
          { error: { message: 'You do not have access to all candidate models in the provided list.' } },
          400,
        );
      }
      if (rejection !== undefined) {
        return c.json({ error: { message: rejection.message } }, 400);
      }
    }
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
