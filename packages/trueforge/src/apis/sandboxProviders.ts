import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { withTimeout } from '@truefoundry/trueforge-core/core';
import type { Logger } from 'winston';
import type { ISandboxProviderStore, SandboxProviderRecord } from '../db/sandboxProviderStore';
import type { WithTransaction } from '../db/transaction';
import { getSandboxProviderRoute, putSandboxProviderRoute } from '../routes/sandboxProviderRoutes';
import {
  checkSandboxBuildStatus,
  isDaytonaAuthError,
  isDaytonaPermissionError,
  isModalAuthError,
  toSandboxProvider,
  toSandboxStatus,
} from '../sandbox/providerUtils';
import type { SandboxProviderManifest, UpdateSandboxProviderRequest } from '../schemas/sandboxProvider';
import { MissingStoredSecretError, resolveStoredSecretValue, toRedactedSecretValue } from '../utils/secretRedaction';
import { TENANT_ID } from './sessions';

/** Cap provider image preparation so a slow/unreachable provider cannot hold the request indefinitely. */
const BUILD_REQUEST_TIMEOUT_MS = 120_000;

export interface SandboxProvidersRouterDeps<TTransaction> {
  sandboxProviderStore: ISandboxProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  logger: Logger;
}

function redactSandboxProvider(manifest: SandboxProviderManifest): SandboxProviderManifest {
  if (manifest.type === 'daytona') {
    return { ...manifest, auth: { api_key: toRedactedSecretValue(manifest.auth.api_key) } };
  }
  return {
    ...manifest,
    auth: {
      token_id: toRedactedSecretValue(manifest.auth.token_id),
      token_secret: toRedactedSecretValue(manifest.auth.token_secret),
    },
  };
}

function resolveManifestSecrets({
  incoming,
  existing,
}: {
  incoming: SandboxProviderManifest;
  existing: SandboxProviderManifest | undefined;
}): SandboxProviderManifest {
  if (incoming.type === 'daytona') {
    return {
      ...incoming,
      auth: {
        api_key: resolveStoredSecretValue({
          incoming: incoming.auth.api_key,
          existing: existing?.type === 'daytona' ? existing.auth.api_key : undefined,
        }),
      },
    };
  }
  return {
    ...incoming,
    auth: {
      token_id: resolveStoredSecretValue({
        incoming: incoming.auth.token_id,
        existing: existing?.type === 'modal' ? existing.auth.token_id : undefined,
      }),
      token_secret: resolveStoredSecretValue({
        incoming: incoming.auth.token_secret,
        existing: existing?.type === 'modal' ? existing.auth.token_secret : undefined,
      }),
    },
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
    const status = await checkSandboxBuildStatus({
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
    const resolveManifest = (existing: SandboxProviderRecord | undefined): SandboxProviderManifest =>
      resolveManifestSecrets({ incoming, existing: existing?.manifest });
    try {
      const existing = await deps.sandboxProviderStore.getSandboxProvider(TENANT_ID);
      const manifest = resolveManifest(existing);
      // Build references are provider-specific and must not survive a provider switch.
      const buildMetadata = existing?.manifest.type === manifest.type ? existing.build_metadata : undefined;
      const provider = toSandboxProvider({
        manifest,
        tenant_id: TENANT_ID,
        logger: deps.logger,
        ...(buildMetadata ? { build_metadata: buildMetadata } : {}),
      });
      const status = toSandboxStatus(
        await withTimeout(provider.buildImage(), BUILD_REQUEST_TIMEOUT_MS, 'sandbox buildImage'),
      );
      await deps.withTransaction(async transaction => {
        await deps.sandboxProviderStore.getSandboxProviderForUpdate(TENANT_ID, transaction);
        await deps.sandboxProviderStore.upsertSandboxProvider(
          { tenant_id: TENANT_ID, manifest, ...status },
          transaction,
        );
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
        return c.json(
          { error: { message: incoming.type === 'daytona' ? 'API key is required' : 'Modal tokens are required' } },
          400,
        );
      }
      if (isDaytonaAuthError(error)) {
        return c.json({ error: { message: 'Daytona rejected the API key — check the credentials' } }, 422);
      }
      if (isDaytonaPermissionError(error)) {
        return c.json(
          {
            error: {
              message:
                'Daytona denied access: the API key is missing required permissions. Grant write:sandboxes, write:snapshots, and delete:snapshots on the key in the Daytona dashboard, then try again.',
            },
          },
          422,
        );
      }
      if (incoming.type === 'modal' && isModalAuthError(error)) {
        return c.json({ error: { message: 'Modal rejected the tokens — check the credentials' } }, 422);
      }
      throw error;
    }
  };

  const router = new OpenAPIHono();
  router.openapi(getSandboxProviderRoute, getHandler);
  router.openapi(putSandboxProviderRoute, putHandler);
  return router;
}
