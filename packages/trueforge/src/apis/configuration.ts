import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { ResolveRequestContext } from '../auth/identity';
import { enabledTenantModelRouting, trueFoundryModelRouting } from '../config';
import type { ConfigurationRecord, IConfigurationStore } from '../db/configurationStore';
import type { IModelProviderStore } from '../db/modelProviderStore';
import { getConfigurationRoute, patchConfigurationRoute } from '../routes/configurationRoutes';
import { describeUncoveredCandidateCategories } from '../runtime/autoModelRouting';
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

/** `enabled` and `candidate_models` change independently: an omitted field keeps its stored value. */
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
      const accessibleModels = await deps
        .resolveModelProviderStore(c)
        .listModels({ tenant_id: requestContext.tenant_id });
      const accessible = new Set(accessibleModels.map(model => model.name));
      const inaccessible = [...new Set(candidateModels)].filter(name => !accessible.has(name));
      if (inaccessible.length > 0) {
        return c.json(
          {
            error: {
              message: `Auto can only use models you have access to. Remove ${inaccessible.join(', ')} from the list and save again.`,
            },
          },
          400,
        );
      }
      // Categories only exist where model routing is set up for the tenant; an empty list clears the choice.
      if (
        candidateModels.length > 0 &&
        enabledTenantModelRouting(trueFoundryModelRouting(), requestContext.tenant_id)
      ) {
        const chosen = new Set(candidateModels);
        const uncovered = describeUncoveredCandidateCategories(
          accessibleModels.filter(model => chosen.has(model.name)),
        );
        if (uncovered !== undefined) {
          return c.json({ error: { message: uncovered } }, 400);
        }
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
