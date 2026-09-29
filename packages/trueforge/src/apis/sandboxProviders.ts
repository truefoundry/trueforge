import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createdBySubjectFromRequestContext, type ResolveRequestContext } from '../auth/identity';
import type { ISandboxEnvironmentStore } from '../db/sandboxEnvironmentStore';
import type { ISandboxProviderStore, SandboxProviderRecord } from '../db/sandboxProviderStore';
import type { WithTransaction } from '../db/transaction';
import { getSandboxProviderRoute, putSandboxProviderRoute } from '../routes/sandboxProviderRoutes';
import { isDaytonaAuthError, isDaytonaPermissionError, validateDaytonaCredentials } from '../sandbox/providerUtils';
import type { SandboxProviderManifest, UpdateSandboxProviderRequest } from '../schemas/sandboxProvider';
import { MissingStoredSecretError, resolveStoredSecretValue, toRedactedSecretValue } from '../utils/secretRedaction';

export interface SandboxProvidersRouterDeps<TTransaction> {
  resolveSandboxProviderStore: (c: Context) => ISandboxProviderStore<TTransaction>;
  sandboxEnvironmentStore: ISandboxEnvironmentStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  resolveRequestContext: ResolveRequestContext;
  /** Override in tests; defaults to a live Daytona snapshot-list probe. */
  validateDaytonaCredentials?: (input: { apiKey: string }) => Promise<void>;
}

function redactSandboxProvider(manifest: SandboxProviderManifest): SandboxProviderManifest {
  return {
    ...manifest,
    auth: { api_key: toRedactedSecretValue(manifest.auth.api_key) },
  };
}

/** Admin/settings sandbox provider surface (mounted at /api/v1/settings/sandbox-providers). */
export function createSandboxProvidersRouter<TTransaction>(deps: SandboxProvidersRouterDeps<TTransaction>) {
  const checkCredentials = deps.validateDaytonaCredentials ?? validateDaytonaCredentials;

  const getHandler: RouteHandler<typeof getSandboxProviderRoute> = async c => {
    const requestContext = deps.resolveRequestContext(c);
    const store = deps.resolveSandboxProviderStore(c);
    const record = await store.getSandboxProvider(requestContext.tenant_id);
    if (record?.manifest.type !== 'daytona') {
      return c.json({ error: { message: 'No sandbox provider configured' } }, 404);
    }
    // Credentials only — snapshot readiness lives on the default sandbox environment.
    return c.json(
      {
        data: {
          manifest: redactSandboxProvider(record.manifest),
          status: record.status,
          status_reason: record.status_reason,
        },
      },
      200,
    );
  };

  const putHandler: RouteHandler<typeof putSandboxProviderRoute> = async c => {
    const body: UpdateSandboxProviderRequest = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);
    const store = deps.resolveSandboxProviderStore(c);
    const incoming = body.manifest;
    const resolveManifest = (existing: SandboxProviderRecord | undefined): SandboxProviderManifest => ({
      ...incoming,
      auth: {
        api_key: resolveStoredSecretValue({
          incoming: incoming.auth.api_key,
          existing: existing?.manifest.type === 'daytona' ? existing.manifest.auth.api_key : undefined,
        }),
      },
    });
    try {
      // Resolve secrets + validate Daytona outside the txn (no remote I/O under an open txn).
      const existing = await store.getSandboxProvider(requestContext.tenant_id);
      const resolved = resolveManifest(existing);
      await checkCredentials({ apiKey: resolved.auth.api_key });

      const { manifest, status, status_reason } = await deps.withTransaction(async transaction => {
        const locked = await store.getSandboxProviderForUpdate(requestContext.tenant_id, transaction);
        // Re-resolve under the lock in case another writer raced the redacted key.
        const lockedResolved = resolveManifest(locked);
        const upserted = await store.upsertSandboxProvider(
          {
            tenant_id: requestContext.tenant_id,
            manifest: lockedResolved,
            status: 'ready',
            status_reason: null,
            build_metadata: locked?.build_metadata ?? null,
          },
          transaction,
        );
        await deps.sandboxEnvironmentStore.createDefaultEnvironment(
          {
            tenant_id: requestContext.tenant_id,
            created_by_subject: createdBySubjectFromRequestContext(requestContext),
          },
          transaction,
        );
        return {
          manifest: lockedResolved,
          status: upserted.status,
          status_reason: upserted.status_reason,
        };
      });
      return c.json(
        {
          data: {
            manifest: redactSandboxProvider(manifest),
            status,
            status_reason,
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
      throw error;
    }
  };

  const router = new OpenAPIHono();
  router.openapi(getSandboxProviderRoute, getHandler);
  router.openapi(putSandboxProviderRoute, putHandler);
  return router;
}
