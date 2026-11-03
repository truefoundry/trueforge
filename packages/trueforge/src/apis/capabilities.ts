import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { Logger } from 'winston';
import {
  areCatalogSettingsAvailable,
  hasAdminRole,
  type RequestContext,
  type ResolveRequestContext,
} from '../auth/identity';
import configuration, { isTrueFoundryModeEnabled } from '../config';
import { isWebSearchEnabledForTenant, type IConfigurationStore } from '../db/configurationStore';
import type { ISandboxEnvironmentStore } from '../db/sandboxEnvironmentStore';
import type { WithTransaction } from '../db/transaction';
import type { IUserStore } from '../db/userStore';
import type { IWebSearchProviderStore } from '../db/webSearchProviderStore';
import { getCapabilitiesRoute } from '../routes/capabilityRoutes';
import { isLocalSandboxFallbackEnabled } from '../sandbox/localRuntime';
import { DEFAULT_SANDBOX_ENVIRONMENT_NAME, type SandboxEnvironmentVersionStatus } from '../schemas/sandboxEnvironment';
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
 * them while provider editing stays with the platform.
 */
function settingsCapability(requestContext: Pick<RequestContext, 'roles'>) {
  const isAdmin = hasAdminRole(requestContext);
  const canManageProviders = areCatalogSettingsAvailable() && isAdmin;
  const catalogSection = { enabled: canManageProviders, manage_providers: canManageProviders };
  return {
    model_providers: catalogSection,
    mcp_servers: catalogSection,
    skills: catalogSection,
    sandbox_providers: catalogSection,
    web_search: { enabled: isAdmin, manage_providers: canManageProviders },
    memory: { enabled: isAdmin, manage_providers: canManageProviders },
  };
}

/**
 * Environments UI/CRUD — matches `envSupported` on the sandbox-environment store.
 * Standalone/OIDC persistence always supports envs; TFY mode only when the shared
 * provider is Daytona. Independent of default-env readiness.
 */
function sandboxEnvironmentsEnabled(): boolean {
  if (!isTrueFoundryModeEnabled(configuration)) {
    return true;
  }
  return configuration.TRUEFOUNDRY_SANDBOX_PROVIDER === 'daytona';
}

export function createCapabilitiesRouter<TTransaction>(deps: {
  sandboxEnvironmentStore: ISandboxEnvironmentStore<TTransaction>;
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
    // Shared TFY provider (incl. on-prem with no env tip), ready default env, or local fallback.
    // hasTrueFoundrySandboxProviderConfig never throws — incomplete TFY settings stay "disabled".
    const sandboxEnabled =
      hasTrueFoundrySandboxProviderConfig() ||
      status === 'ready' ||
      (defaultEnv === undefined && isLocalSandboxFallbackEnabled());
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
    return c.json(
      {
        data: {
          sandbox: {
            enabled: sandboxEnabled,
            environments: { enabled: sandboxEnvironmentsEnabled() },
          },
          skill: sandboxEnabled ? { enabled: true } : { enabled: false, reason: skillDisabledReason(status) },
          settings: settingsCapability(requestContext),
          web_search: webSearchResponse,
          session_sharing: { enabled: deps.userStore.supportsUserLookup },
        },
      },
      200,
    );
  });
  return router;
}
