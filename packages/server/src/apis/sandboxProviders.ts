import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Logger } from 'winston';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import type { WithTransaction } from '../db/transaction';
import { getSandboxProviderRoute, putSandboxProviderRoute } from '../routes/sandboxProviderRoutes';
import { getSandboxProvider, isDaytonaAuthError, toSandboxImage } from '../sandbox/providerUtils';
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
    // Image status is not persisted; read it live from the provider on every GET.
    const provider = getSandboxProvider({ manifest: record.manifest, tenant_id: TENANT_ID, logger: deps.logger });
    const build = await provider.getImageBuildStatus();
    return c.json({ data: { ...redactSandboxProvider(record.manifest), image: toSandboxImage(build) } }, 200);
  };

  const putHandler: RouteHandler<typeof putSandboxProviderRoute> = async c => {
    const incoming: SandboxProvider = c.req.valid('json');
    try {
      const { record, build } = await deps.withTransaction(async transaction => {
        const existing = await deps.sandboxProviderStore.getSandboxProviderForUpdate(TENANT_ID, transaction);
        const manifest: SandboxProvider = {
          ...incoming,
          auth: {
            api_key: resolveStoredSecretValue({
              incoming: incoming.auth.api_key,
              existing: existing?.manifest.auth.api_key,
            }),
          },
        };
        // Kick off the image build (and validate credentials) before persisting bad config.
        const provider = getSandboxProvider({ manifest, tenant_id: TENANT_ID, logger: deps.logger });
        const build = await provider.buildImage();
        const record = await deps.sandboxProviderStore.upsertSandboxProvider(
          { tenant_id: TENANT_ID, manifest },
          transaction,
        );
        return { record, build };
      });
      return c.json({ data: { ...redactSandboxProvider(record.manifest), image: toSandboxImage(build) } }, 200);
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
