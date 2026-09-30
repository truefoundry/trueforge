import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { Logger } from 'winston';
import { createdBySubjectFromRequestContext, type ResolveRequestContext } from '../auth/identity';
import type { ISandboxEnvironmentStore } from '../db/sandboxEnvironmentStore';
import type { ISandboxProviderStore, SandboxProviderRecord } from '../db/sandboxProviderStore';
import type { WithTransaction } from '../db/transaction';
import { getSandboxProviderRoute, putSandboxProviderRoute } from '../routes/sandboxProviderRoutes';
import { ensureDefaultSandboxEnvironment } from '../sandbox/ensureDefaultSandboxEnvironment';
import { isDaytonaAuthError, isDaytonaPermissionError, validateSandboxProviderAccess } from '../sandbox/providerUtils';
import type { SandboxProviderManifest, UpdateSandboxProviderRequest } from '../schemas/sandboxProvider';
import { MissingStoredSecretError, resolveStoredSecretValue, toRedactedSecretValue } from '../utils/secretRedaction';

export interface SandboxProvidersRouterDeps<TTransaction> {
  resolveSandboxProviderStore: (c: Context) => ISandboxProviderStore<TTransaction>;
  sandboxEnvironmentStore: ISandboxEnvironmentStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  logger: Logger;
  resolveRequestContext: ResolveRequestContext;
}

function redactSandboxProvider(manifest: SandboxProviderManifest): SandboxProviderManifest {
  return {
    ...manifest,
    auth: { api_key: toRedactedSecretValue(manifest.auth.api_key) },
  };
}

/** Settings API is Daytona-only; TFY may synthesize a `truefoundry` row without `auth`. */
function storedApiKey(record: SandboxProviderRecord | undefined): string | undefined {
  const manifest = record?.manifest;
  if (manifest?.type !== 'daytona') {
    return undefined;
  }
  return manifest.auth.api_key;
}

/** Admin/settings sandbox provider surface (mounted at /api/v1/settings/sandbox-providers). */
export function createSandboxProvidersRouter<TTransaction>(deps: SandboxProvidersRouterDeps<TTransaction>) {
  const getHandler: RouteHandler<typeof getSandboxProviderRoute> = async c => {
    const requestContext = deps.resolveRequestContext(c);
    const store = deps.resolveSandboxProviderStore(c);
    const record = await store.getSandboxProvider(requestContext.tenant_id);
    if (record?.manifest.type !== 'daytona') {
      return c.json({ error: { message: 'No sandbox provider configured' } }, 404);
    }
    return c.json(
      {
        data: {
          manifest: redactSandboxProvider(record.manifest),
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
          existing: storedApiKey(existing),
        }),
      },
    });
    try {
      const existing = await store.getSandboxProvider(requestContext.tenant_id);
      const resolved = resolveManifest(existing);
      await validateSandboxProviderAccess({
        manifest: resolved,
        tenant_id: requestContext.tenant_id,
        logger: deps.logger,
      });

      const manifest = await deps.withTransaction(async transaction => {
        const locked = await store.getSandboxProviderForUpdate(requestContext.tenant_id, transaction);
        const lockedResolved = resolveManifest(locked);
        const previousKey = storedApiKey(locked);
        const keyChanged = previousKey !== undefined && previousKey !== lockedResolved.auth.api_key;

        await store.upsertSandboxProvider(
          {
            tenant_id: requestContext.tenant_id,
            manifest: lockedResolved,
          },
          transaction,
        );

        await ensureDefaultSandboxEnvironment({
          store: deps.sandboxEnvironmentStore,
          tenant_id: requestContext.tenant_id,
          created_by_subject: createdBySubjectFromRequestContext(requestContext),
          provider_type: lockedResolved.type,
          resetPending: keyChanged,
          transaction,
        });

        return lockedResolved;
      });
      return c.json(
        {
          data: {
            manifest: redactSandboxProvider(manifest),
          },
        },
        200,
      );
    } catch (error) {
      if (error instanceof MissingStoredSecretError) {
        return c.json({ error: { message: 'API key is required' } }, 400);
      }
      if (isDaytonaAuthError(error)) {
        return c.json({ error: { message: 'Sandbox provider rejected the API key — check the credentials' } }, 422);
      }
      if (isDaytonaPermissionError(error)) {
        return c.json(
          {
            error: {
              message:
                'Sandbox provider denied access: the API key is missing required permissions. Grant write:sandboxes, write:snapshots, and delete:snapshots on the key, then try again.',
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
