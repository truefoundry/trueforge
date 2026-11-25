import { OpenAPIHono } from '@hono/zod-openapi';
import { canRouteEveryCategory, restrictToCandidateModels } from '@truefoundry/trueforge-core/core';
import type { Context } from 'hono';
import type { Logger } from 'winston';
import { areCatalogSettingsAvailable, hasAdminRole, type ResolveRequestContext } from '../auth/identity';
import { enabledTenantModelRouting, trueFoundryModelRouting } from '../config';
import {
  getAutoModelRoutingForTenant,
  isMemoryEnabledForTenant,
  isWebSearchEnabledForTenant,
  type IConfigurationStore,
} from '../db/configurationStore';
import type { IMemoryProviderStore } from '../db/memoryProviderStore';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { ISandboxEnvironmentStore } from '../db/sandboxEnvironmentStore';
import type { WithTransaction } from '../db/transaction';
import type { IUserStore } from '../db/userStore';
import type { IWebSearchProviderStore } from '../db/webSearchProviderStore';
import { hasConfiguredMemoryProvider } from '../memory/providers';
import { getCapabilitiesRoute, type AutoCapability, type SessionSharingCapability } from '../routes/capabilityRoutes';
import { sandboxEnvironmentsEnabled } from '../sandbox/environment/support';
import { isLocalSandboxFallbackEnabled } from '../sandbox/localRuntime';
import type { SandboxEnvironmentVersionStatus } from '../schemas/sandboxEnvironment';
import { hasTrueFoundrySandboxProviderConfig } from '../truefoundry/resolveTrueFoundrySandboxProviderConfig';
import { hasConfiguredWebSearchProvider } from '../websearch/providers';

/**
 * Why skills are unavailable, keyed off the default sandbox environment status.
 * `pending` is transient (retry); everything else (missing / failed) reads as not configured.
 */
function skillDisabledReason(status: SandboxEnvironmentVersionStatus | undefined): string {
  if (status === 'pending') {
    return 'Skills run in a sandbox whose image is still being prepared — retry shortly.';
  }
  return 'Skills run in a sandbox, which is not configured.';
}

/**
 * Settings sections the caller may open.
 *
 * Catalog sections need a deployment that owns its own catalogs; the tenant switches
 * (web search, memory) only need the admin role, so a TrueFoundry tenant admin reaches
 * them while provider editing stays with the platform. In TrueFoundry mode the memory
 * section also needs the platform's provider, which the env offers per tenant. The Auto
 * switch has no section here: clients show it from the `auto` capability.
 */
function settingsCapability({
  isAdmin,
  ownsCatalogs,
  hasMemoryProvider,
}: {
  isAdmin: boolean;
  /** False in TrueFoundry mode, where the platform owns the provider catalogs. */
  ownsCatalogs: boolean;
  /** In TrueFoundry mode, true when the platform's env offers memory to the tenant. */
  hasMemoryProvider: boolean;
}) {
  const canManageProviders = ownsCatalogs && isAdmin;
  const catalogSection = { enabled: canManageProviders, manage_providers: canManageProviders };
  return {
    model_providers: catalogSection,
    mcp_servers: catalogSection,
    skills: catalogSection,
    sandbox_providers: catalogSection,
    web_search: { enabled: isAdmin, manage_providers: canManageProviders },
    memory_providers: { enabled: isAdmin && (ownsCatalogs || hasMemoryProvider), manage_providers: canManageProviders },
  };
}

const AUTO_TURNED_OFF_REASON = 'Auto mode is turned off for this tenant - an admin can turn it back on in settings.';
const AUTO_UNAVAILABLE_REASON = 'Auto mode is not available for now';
const AUTO_MODELS_RESTRICTED_REASON =
  'Auto mode has no usable models selected - an admin can choose models for it in settings.';

/**
 * Auto needs model routing set up for the tenant, the tenant switch on, and a model the user has in every routing
 * cluster, among the models the admin allows (none until they choose some). `not_configured` when routing isn't set up, so clients hide Auto
 * entirely. A failed listing fails the request, so clients keep their last known capabilities instead of dropping a
 * selected Auto.
 */
async function autoCapability({
  tenant_id,
  modelProviderStore,
  configurationStore,
}: {
  tenant_id: string;
  modelProviderStore: IModelProviderStore;
  configurationStore: IConfigurationStore;
}): Promise<AutoCapability> {
  if (enabledTenantModelRouting(trueFoundryModelRouting(), tenant_id) === undefined) {
    return { status: 'not_configured' };
  }
  const autoModelRouting = await getAutoModelRoutingForTenant({ tenant_id, store: configurationStore });
  if (!autoModelRouting.enabled) {
    return { status: 'disabled', reason: AUTO_TURNED_OFF_REASON };
  }
  const userModels = await modelProviderStore.listModels({ tenant_id });
  const candidateModels = restrictToCandidateModels({
    models: userModels,
    candidateModels: autoModelRouting.candidate_models,
  });
  if (canRouteEveryCategory(candidateModels)) {
    return { status: 'enabled' };
  }
  // Tells an admin-fixable restriction apart from a user who simply lacks the models.
  return {
    status: 'disabled',
    reason: canRouteEveryCategory(userModels) ? AUTO_MODELS_RESTRICTED_REASON : AUTO_UNAVAILABLE_REASON,
  };
}

export function createCapabilitiesRouter<TTransaction>(deps: {
  sandboxEnvironmentStore: ISandboxEnvironmentStore<TTransaction>;
  webSearchProviderStore: IWebSearchProviderStore<TTransaction>;
  configurationStore: IConfigurationStore;
  memoryProviderStore: IMemoryProviderStore<TTransaction>;
  resolveModelProviderStore: (c: Context) => IModelProviderStore<TTransaction>;
  userStore: IUserStore;
  withTransaction: WithTransaction<TTransaction>;
  logger: Logger;
  resolveRequestContext: ResolveRequestContext;
}) {
  const router = new OpenAPIHono();
  router.openapi(getCapabilitiesRoute, async c => {
    const requestContext = deps.resolveRequestContext(c);
    // Shared TFY provider (incl. on-prem with no env tip), any enabled ready env, or local fallback.
    // hasTrueFoundrySandboxProviderConfig never throws — incomplete TFY settings stay "disabled".
    const sandboxEnabled =
      hasTrueFoundrySandboxProviderConfig() ||
      isLocalSandboxFallbackEnabled() ||
      (await deps.sandboxEnvironmentStore.hasUsableEnvironment({ tenant_id: requestContext.tenant_id }));
    // Only read the default row on the disabled path, where its status turns "not configured"
    // into the more useful "still being prepared".
    const skillDisabled = sandboxEnabled
      ? undefined
      : skillDisabledReason(
          (await deps.sandboxEnvironmentStore.getDefaultEnvironment({ tenant_id: requestContext.tenant_id }))?.version
            .status,
        );
    const [hasProvider, tenantAllowsWebSearch, tenantAllowsMemory, hasMemoryProvider, auto] = await Promise.all([
      hasConfiguredWebSearchProvider({
        tenant_id: requestContext.tenant_id,
        store: deps.webSearchProviderStore,
      }),
      isWebSearchEnabledForTenant({
        tenant_id: requestContext.tenant_id,
        store: deps.configurationStore,
      }),
      isMemoryEnabledForTenant({
        tenant_id: requestContext.tenant_id,
        store: deps.configurationStore,
      }),
      hasConfiguredMemoryProvider({
        tenant_id: requestContext.tenant_id,
        store: deps.memoryProviderStore,
      }),
      autoCapability({
        tenant_id: requestContext.tenant_id,
        modelProviderStore: deps.resolveModelProviderStore(c),
        configurationStore: deps.configurationStore,
      }),
    ]);

    const webSearchResponse: { enabled: boolean; reason?: string } = {
      enabled: true,
    };
    if (!tenantAllowsWebSearch) {
      webSearchResponse.enabled = false;
      webSearchResponse.reason = 'Web search is turned off for this tenant - an admin can turn it back on in settings.';
    } else if (!hasProvider) {
      webSearchResponse.enabled = false;
      webSearchResponse.reason = 'Web search needs a provider, which is not configured.';
    }

    // Left out without a provider, so clients hide every memory setting.
    let memoryResponse: { enabled: boolean; reason?: string } | undefined;
    if (hasMemoryProvider && tenantAllowsMemory) {
      memoryResponse = { enabled: true };
    } else if (hasMemoryProvider) {
      memoryResponse = {
        enabled: false,
        reason: 'Memory is turned off for this tenant - an admin can turn it back on in settings.',
      };
    }
    const sessionSharing: SessionSharingCapability = {
      granularity: deps.userStore.supportsUserLookup ? 'subject' : 'tenant',
    };
    return c.json(
      {
        data: {
          sandbox: {
            enabled: sandboxEnabled,
            environments: { enabled: sandboxEnvironmentsEnabled() },
          },
          skill: skillDisabled === undefined ? { enabled: true } : { enabled: false, reason: skillDisabled },
          settings: settingsCapability({
            isAdmin: hasAdminRole(requestContext),
            ownsCatalogs: areCatalogSettingsAvailable(),
            hasMemoryProvider,
          }),
          web_search: webSearchResponse,
          ...(memoryResponse && { memory: memoryResponse }),
          auto,
          session_sharing: sessionSharing,
        },
      },
      200,
    );
  });
  return router;
}
