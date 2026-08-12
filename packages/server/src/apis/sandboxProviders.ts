import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Logger } from 'winston';
import type { ISandboxProviderStore, SandboxProviderRecord } from '../db/sandboxProviderStore';
import type { WithTransaction } from '../db/transaction';
import { getSandboxProviderRoute, putSandboxProviderRoute } from '../routes/sandboxProviderRoutes';
import { getSandboxProvider, isDaytonaAuthError, safeSandboxBuild, toSandboxBuild } from '../sandbox/providerUtils';
import type { SandboxProvider } from '../schemas/sandboxProvider';
import { MissingStoredSecretError, resolveStoredSecretValue, toRedactedSecretValue } from '../utils/secretRedaction';
import { TENANT_ID } from './sessions';

export interface SandboxProvidersRouterDeps<TTransaction> {
  sandboxProviderStore: ISandboxProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  logger: Logger;
}

function redactSandboxProvider(manifest: SandboxProvider): SandboxProvider {
  return {
    ...manifest,
    auth: { api_key: toRedactedSecretValue(manifest.auth.api_key) },
  };
}

/** Admin/settings sandbox provider surface (mounted at /api/v1/settings/sandbox-providers). */
export function createSandboxProvidersRouter<TTransaction>(deps: SandboxProvidersRouterDeps<TTransaction>) {
  const getHandler: RouteHandler<typeof getSandboxProviderRoute> = async c => {
    const record = await deps.sandboxProviderStore.getSandboxProvider(TENANT_ID);
    if (record === undefined) {
      return c.json({ error: { message: 'No sandbox provider configured' } }, 404);
    }
    // Build status is not persisted; read it live from the provider on every GET. A Daytona
    // outage or bad key must not hide the stored config (admins need it to rotate creds), so
    // safeSandboxBuild degrades to a failed build instead of throwing.
    const provider = getSandboxProvider({ manifest: record.manifest, tenant_id: TENANT_ID, logger: deps.logger });
    const build = await safeSandboxBuild({ provider, logger: deps.logger });
    return c.json({ data: { ...redactSandboxProvider(record.manifest), ...build } }, 200);
  };

  const putHandler: RouteHandler<typeof putSandboxProviderRoute> = async c => {
    const incoming: SandboxProvider = c.req.valid('json');
    const resolveManifest = (existing: SandboxProviderRecord | undefined): SandboxProvider => ({
      ...incoming,
      auth: {
        api_key: resolveStoredSecretValue({
          incoming: incoming.auth.api_key,
          existing: existing?.manifest.auth.api_key,
        }),
      },
    });
    try {
      // Validate the key + kick off the build (Daytona network I/O) BEFORE persisting, outside any
      // transaction so no row lock is held during remote I/O. A bad key throws here → 422, nothing saved.
      const snapshot = await deps.sandboxProviderStore.getSandboxProvider(TENANT_ID);
      const provider = getSandboxProvider({
        manifest: resolveManifest(snapshot),
        tenant_id: TENANT_ID,
        logger: deps.logger,
      });
      const build = await provider.buildImage();
      // Persist under a row lock (local DB work only), re-resolving the secret from the locked row so
      // a concurrent keep/rotate cannot interleave — same contract as the model-provider PUT.
      const record = await deps.withTransaction(async transaction => {
        const locked = await deps.sandboxProviderStore.getSandboxProviderForUpdate(TENANT_ID, transaction);
        return deps.sandboxProviderStore.upsertSandboxProvider(
          { tenant_id: TENANT_ID, manifest: resolveManifest(locked) },
          transaction,
        );
      });
      return c.json({ data: { ...redactSandboxProvider(record.manifest), ...toSandboxBuild(build) } }, 200);
    } catch (error) {
      if (error instanceof MissingStoredSecretError) {
        return c.json({ error: { message: 'API key is required' } }, 400);
      }
      if (isDaytonaAuthError(error)) {
        return c.json({ error: { message: 'Daytona rejected the API key — check the credentials' } }, 422);
      }
      throw error;
    }
  };

  const router = new OpenAPIHono();
  router.openapi(getSandboxProviderRoute, getHandler);
  router.openapi(putSandboxProviderRoute, putHandler);
  return router;
}
