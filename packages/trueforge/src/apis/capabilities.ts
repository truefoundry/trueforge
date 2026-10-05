import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { Logger } from 'winston';
import { hasAdminRole, type ResolveRequestContext } from '../auth/identity';
import type { ISandboxEnvironmentStore } from '../db/sandboxEnvironmentStore';
import type { WithTransaction } from '../db/transaction';
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

export function createCapabilitiesRouter<TTransaction>(deps: {
  sandboxEnvironmentStore: ISandboxEnvironmentStore<TTransaction>;
  resolveWebSearchProviderStore: (c: Context) => IWebSearchProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  logger: Logger;
  resolveRequestContext: ResolveRequestContext;
}) {
  const router = new OpenAPIHono();
  router.openapi(getCapabilitiesRoute, async c => {
    const requestContext = deps.resolveRequestContext(c);
    const defaultEnv = await deps.sandboxEnvironmentStore.getEnvironment({
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
    const settingsEnabled = hasAdminRole(requestContext);
    const webSearchEnabled = await hasConfiguredWebSearchProvider({
      tenant_id: requestContext.tenant_id,
      store: deps.resolveWebSearchProviderStore(c),
    });
    return c.json(
      {
        data: {
          sandbox: { enabled: sandboxEnabled },
          skill: sandboxEnabled ? { enabled: true } : { enabled: false, reason: skillDisabledReason(status) },
          settings: { enabled: settingsEnabled },
          web_search: { enabled: webSearchEnabled },
        },
      },
      200,
    );
  });
  return router;
}
