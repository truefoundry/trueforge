import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { withTimeout } from '@truefoundry/trueforge-core/core';
import type { Logger } from 'winston';
import type { ISandboxProviderStore, SandboxProviderRecord } from '../db/sandboxProviderStore';
import type { WithTransaction } from '../db/transaction';
import { getSandboxProviderRoute, putSandboxProviderRoute } from '../routes/sandboxProviderRoutes';
import {
  checkSandboxProviderStatus,
  isSandboxProviderAuthError,
  toSandboxProvider,
  toSandboxStatus,
} from '../sandbox/providerUtils';
import type { SandboxProviderManifest, UpdateSandboxProviderRequest } from '../schemas/sandboxProvider';
import { MissingStoredSecretError, resolveStoredSecretValue, toRedactedSecretValue } from '../utils/secretRedaction';
import { TENANT_ID } from './sessions';

/** Cap the provider registration round-trip so a slow/unreachable provider cannot hold the request open. */
const BUILD_REQUEST_TIMEOUT_MS = 3_000;
const MAX_CONCURRENT_UPDATE_RETRIES = 3;

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

function samePrebuildRecord(params: {
  before: SandboxProviderRecord | undefined;
  locked: SandboxProviderRecord | undefined;
}): boolean {
  if (params.before === undefined || params.locked === undefined) {
    return params.before === params.locked;
  }
  return (
    params.before.updated_at === params.locked.updated_at &&
    JSON.stringify(params.before.manifest) === JSON.stringify(params.locked.manifest) &&
    JSON.stringify(params.before.build_metadata) === JSON.stringify(params.locked.build_metadata)
  );
}

/** Admin/settings sandbox provider surface (mounted at /api/v1/settings/sandbox-providers). */
export function createSandboxProvidersRouter<TTransaction>(deps: SandboxProvidersRouterDeps<TTransaction>) {
  const getHandler: RouteHandler<typeof getSandboxProviderRoute> = async c => {
    const record = await deps.sandboxProviderStore.getSandboxProvider(TENANT_ID);
    if (record === undefined) {
      return c.json({ error: { message: 'No sandbox provider configured' } }, 404);
    }
    // Refresh a pending build, or perform provider-specific maintenance for a ready build.
    const status = await checkSandboxProviderStatus({
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
          existing: existing?.manifest.type === incoming.type ? existing.manifest.auth.api_key : undefined,
        }),
      },
    });
    try {
      let saved: { manifest: SandboxProviderManifest; status: ReturnType<typeof toSandboxStatus> } | undefined;
      for (let attempt = 1; attempt <= MAX_CONCURRENT_UPDATE_RETRIES && saved === undefined; attempt++) {
        const existing = await deps.sandboxProviderStore.getSandboxProvider(TENANT_ID);
        const resolved = resolveManifest(existing);
        const provider = toSandboxProvider({
          manifest: resolved,
          tenant_id: TENANT_ID,
          logger: deps.logger,
          ...(existing?.manifest.type === resolved.type && existing.manifest.auth.api_key === resolved.auth.api_key
            ? { build_metadata: existing.build_metadata }
            : {}),
        });
        const built = toSandboxStatus(
          await withTimeout(provider.buildImage(), BUILD_REQUEST_TIMEOUT_MS, 'sandbox buildImage'),
        );

        saved = await deps.withTransaction(async transaction => {
          const locked = await deps.sandboxProviderStore.getSandboxProviderForUpdate(TENANT_ID, transaction);
          // Persist only if every stored build input still matches the preflight read.
          if (!samePrebuildRecord({ before: existing, locked })) {
            return undefined;
          }
          await deps.sandboxProviderStore.upsertSandboxProvider(
            { tenant_id: TENANT_ID, manifest: resolved, ...built },
            transaction,
          );
          return { manifest: resolved, status: built };
        });
      }
      if (saved === undefined) {
        return c.json({ error: { message: 'Sandbox provider changed concurrently; retry the update' } }, 409);
      }
      return c.json(
        {
          data: {
            manifest: redactSandboxProvider(saved.manifest),
            status: saved.status.status,
            status_reason: saved.status.status_reason,
          },
        },
        200,
      );
    } catch (error) {
      if (error instanceof MissingStoredSecretError) {
        return c.json({ error: { message: 'API key is required' } }, 400);
      }
      if (isSandboxProviderAuthError({ error, providerType: incoming.type })) {
        const providerName = incoming.type === 'daytona' ? 'Daytona' : 'E2B';
        return c.json({ error: { message: `${providerName} rejected the API key — check the credentials` } }, 422);
      }
      throw error;
    }
  };

  const router = new OpenAPIHono();
  router.openapi(getSandboxProviderRoute, getHandler);
  router.openapi(putSandboxProviderRoute, putHandler);
  return router;
}
