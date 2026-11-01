import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { Logger } from 'winston';
import {
  areCatalogSettingsAvailable,
  hasAdminRole,
  type RequestContext,
  type ResolveRequestContext,
} from '../auth/identity';
import { isWebSearchEnabledForTenant } from '../configurations/configurations';
import type { IConfigurationStore } from '../db/configurationStore';
import type { ISandboxEnvironmentStore } from '../db/sandboxEnvironmentStore';
import type { WithTransaction } from '../db/transaction';
import type { IUserStore } from '../db/userStore';
import type { IWebSearchProviderStore } from '../db/webSearchProviderStore';
import { getCapabilitiesRoute } from '../routes/capabilityRoutes';
import { isLocalSandboxFallbackEnabled } from '../sandbox/localRuntime';
import { DEFAULT_SANDBOX_ENVIRONMENT_NAME, type SandboxEnvironmentVersionStatus } from '../schemas/sandboxEnvironment';
import { hasTrueFoundrySandboxProviderConfig } from '../truefoundry/resolveTrueFoundrySandboxProviderConfig';
import { hasConfiguredWebSearchProvider } from '../websearch/providers';

const SANDBOX_DISABLED_REASON = 'Sandboxes are turned off for this tenant. An admin can turn them back on in settings.';

/**
 * Why skills are unavailable, keyed off the default sandbox environment status.
 * `pending` is transient (retry); everything else (missing / failed) reads as not configured.
 */
function skillDisabledReason({
  status,
  tenantAllows,
}: {
  status: SandboxEnvironmentVersionStatus | undefined;
  tenantAllows: boolean;
}): string {
  if (!tenantAllows) {
    return SANDBOX_DISABLED_REASON;
  }
  if (status === 'pending') {
    return 'Skills run in a sandbox whose image is still being prepared — retry shortly.';
  }
  return 'Skills run in a sandbox, which is not configured.';
}

/**
 * Why a new chat cannot turn web search on.
 * The tenant switch is reported first; otherwise no provider is configured.
 */
function webSearchDisabledReason({ tenantAllows }: { tenantAllows: boolean }): string {
  if (!tenantAllows) {
    return 'Web search is turned off for this tenant - an admin can turn it back on in settings.';
  }
  return 'Web search needs a provider, which is not configured.';
}

/**
 * Settings sections the caller may open.
 *
 * Catalog sections need a deployment that owns its own catalogs; the tenant switches
 * (web search, memory) only need the admin role, so a TrueFoundry tenant admin reaches
 * them while provider editing stays with the platform.
 */
function settingsCapability(requestContext: Pick<RequestContext, 'roles'>) {
  const isAdmin = hasAdminRole(requestContext);
  const catalogs = areCatalogSettingsAvailable() && isAdmin;
  const catalogSection = { enabled: catalogs, manage_providers: catalogs };
  return {
    model_providers: catalogSection,
    mcp_servers: catalogSection,
    skills: catalogSection,
    sandbox_providers: catalogSection,
    web_search: { enabled: isAdmin, manage_providers: catalogs },
    memory: { enabled: isAdmin, manage_providers: catalogs },
  };
}

export function createCapabilitiesRouter<TTransaction>(deps: {
  sandboxEnvironmentStore: Pick<ISandboxEnvironmentStore<TTransaction>, 'getActiveEnvironment'>;
  resolveWebSearchProviderStore: (c: Context) => IWebSearchProviderStore<TTransaction>;
  resolveConfigurationStore: (c: Context) => IConfigurationStore<TTransaction>;
  userStore: IUserStore;
  withTransaction: WithTransaction<TTransaction>;
  logger: Logger;
  resolveRequestContext: ResolveRequestContext;
}) {
  const router = new OpenAPIHono();
  router.openapi(getCapabilitiesRoute, async c => {
    const requestContext = deps.resolveRequestContext(c);
    const defaultEnv = await deps.sandboxEnvironmentStore.getActiveEnvironment({
      tenant_id: requestContext.tenant_id,
      name: DEFAULT_SANDBOX_ENVIRONMENT_NAME,
    });
    const status = defaultEnv?.version.status;
    // The default environment is what a chat gets when its spec names none, so turning it
    // off is the tenant-wide sandbox switch and outranks every "is it configured" branch.
    const tenantAllowsSandbox = defaultEnv?.environment.enabled !== false;
    // Shared TFY provider (incl. on-prem with no env tip), ready default env, or local fallback.
    // hasTrueFoundrySandboxProviderConfig never throws — incomplete TFY settings stay "disabled".
    const sandboxEnabled =
      tenantAllowsSandbox &&
      (hasTrueFoundrySandboxProviderConfig() ||
        status === 'ready' ||
        (defaultEnv === undefined && isLocalSandboxFallbackEnabled()));
    const [hasProvider, tenantAllowsWebSearch] = await Promise.all([
      hasConfiguredWebSearchProvider({
        tenant_id: requestContext.tenant_id,
        store: deps.resolveWebSearchProviderStore(c),
      }),
      isWebSearchEnabledForTenant({
        tenant_id: requestContext.tenant_id,
        store: deps.resolveConfigurationStore(c),
      }),
    ]);
    const webSearchEnabled = tenantAllowsWebSearch && hasProvider;
    return c.json(
      {
        data: {
          sandbox: sandboxEnabled
            ? { enabled: true }
            : { enabled: false, ...(tenantAllowsSandbox ? {} : { reason: SANDBOX_DISABLED_REASON }) },
          skill: sandboxEnabled
            ? { enabled: true }
            : { enabled: false, reason: skillDisabledReason({ status, tenantAllows: tenantAllowsSandbox }) },
          settings: settingsCapability(requestContext),
          web_search: webSearchEnabled
            ? { enabled: true }
            : { enabled: false, reason: webSearchDisabledReason({ tenantAllows: tenantAllowsWebSearch }) },
          session_sharing: { enabled: deps.userStore.supportsUserLookup },
        },
      },
      200,
    );
  });
  return router;
}
