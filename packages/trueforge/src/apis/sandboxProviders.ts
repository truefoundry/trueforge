import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { withTimeout } from '@truefoundry/trueforge-core/core';
import type { Logger } from 'winston';
import type { ISandboxProviderStore, SandboxProviderRecord } from '../db/sandboxProviderStore';
import type { WithTransaction } from '../db/transaction';
import { getSandboxProviderRoute, putSandboxProviderRoute } from '../routes/sandboxProviderRoutes';
import {
  checkSnapshotStatus,
  isDaytonaAuthError,
  toDaytonaSandboxProvider,
  toSandboxStatus,
} from '../sandbox/providerUtils';
import type { SandboxProviderManifest, UpdateSandboxProviderRequest } from '../schemas/sandboxProvider';
import { MissingStoredSecretError, resolveStoredSecretValue, toRedactedSecretValue } from '../utils/secretRedaction';
import { TENANT_ID } from './sessions';

/** Cap the Daytona register round-trip so a slow/unreachable provider can't hold the request (or DB txn) open. */
const BUILD_REQUEST_TIMEOUT_MS = 3_000;

export interface SandboxProvidersRouterDeps<TTransaction> {
  sandboxProviderStore: ISandboxProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  logger: Logger;
}

function redactSandboxProvider(manifest: SandboxProviderManifest): SandboxProviderManifest {
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
    // Refresh the persisted build status (and re-activate an idle snapshot) on every GET.
    const status = await checkSnapshotStatus({
      store: deps.sandboxProviderStore,
      tenant_id: TENANT_ID,
      logger: deps.logger,
    });
    return c.json(
      {
        data: {
          manifest: redactSandboxProvider(record.manifest),
          status: status?.status ?? record.status,
          status_reason: status?.status_reason ?? record.status_reason,
        },
      },
      200,
    );
  };

  const putHandler: RouteHandler<typeof putSandboxProviderRoute> = async c => {
    const body: UpdateSandboxProviderRequest = c.req.valid('json');
    const incoming = body.manifest;
    const resolveManifest = (existing: SandboxProviderRecord | undefined): SandboxProviderManifest => ({
      ...incoming,
      auth: {
        api_key: resolveStoredSecretValue({
          incoming: incoming.auth.api_key,
          existing: existing?.manifest.auth.api_key,
        }),
      },
    });
    try {
      // NOTE: build (Daytona network I/O) runs inside the transaction for now; the design is being revisited.
      const { manifest, status } = await deps.withTransaction(async transaction => {
        const locked = await deps.sandboxProviderStore.getSandboxProviderForUpdate(TENANT_ID, transaction);
        const resolved = resolveManifest(locked);
        // Pass persisted build_metadata so a settings re-save does not start a new snapshot for a
        // bumped SANDBOX_IMAGE_URI (upgrades are unsupported — first configure has no metadata).
        const provider = toDaytonaSandboxProvider({
          manifest: resolved,
          tenant_id: TENANT_ID,
          logger: deps.logger,
          ...(locked ? { build_metadata: locked.build_metadata } : {}),
        });
        const built = toSandboxStatus(
          await withTimeout(provider.buildImage(), BUILD_REQUEST_TIMEOUT_MS, 'sandbox buildImage'),
        );
        await deps.sandboxProviderStore.upsertSandboxProvider(
          { tenant_id: TENANT_ID, manifest: resolved, ...built },
          transaction,
        );
        return { manifest: resolved, status: built };
      });
      return c.json(
        {
          data: {
            manifest: redactSandboxProvider(manifest),
            status: status.status,
            status_reason: status.status_reason,
          },
        },
        200,
      );
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
