/**
 * Sandbox environments API (mounted at /api/v1/sandbox-environments).
 * Snapshot builds are not started here — versions land in `pending` for a future controller.
 * Networking secrets sync to Daytona on PUT (plaintext is never persisted).
 */
import { DaytonaError } from '@daytona/sdk';
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { InvalidPageTokenError } from '@truefoundry/trueforge-core/agent-session';
import type { Context } from 'hono';
import type { Logger } from 'winston';
import { createdBySubjectFromRequestContext, type ResolveRequestContext } from '../auth/identity';
import type { IAgentStore } from '../db/agentStore';
import {
  SandboxEnvironmentNameConflictError,
  SandboxEnvironmentVersionConflictError,
  type ISandboxEnvironmentStore,
  type SandboxEnvironmentWithVersion,
} from '../db/sandboxEnvironmentStore';
import type { ISandboxProviderStore, SandboxProviderRecord } from '../db/sandboxProviderStore';
import {
  deleteSandboxEnvironmentRoute,
  getSandboxEnvironmentRoute,
  listSandboxEnvironmentsRoute,
  putSandboxEnvironmentRoute,
} from '../routes/sandboxEnvironmentRoutes';
import { getDaytonaAuthorizationErrorMessage, toDaytonaSandboxProvider } from '../sandbox/providerUtils';
import { buildNextVersion, redactManifestSecrets } from '../sandbox/sandboxEnvironmentVersion';
import {
  deleteSandboxEnvironmentSecrets,
  SandboxEnvironmentSecretSyncError,
  syncSandboxEnvironmentSecrets,
} from '../sandbox/syncSandboxEnvironmentSecrets';
import { DEFAULT_SANDBOX_ENVIRONMENT_NAME, type SandboxEnvironment } from '../schemas/sandboxEnvironment';
import { MissingStoredSecretError } from '../utils/secretRedaction';

export interface SandboxEnvironmentsRouterDeps<TTransaction> {
  sandboxEnvironmentStore: ISandboxEnvironmentStore<TTransaction>;
  resolveAgentStore: (c: Context) => IAgentStore<TTransaction>;
  resolveSandboxProviderStore: (c: Context) => ISandboxProviderStore<TTransaction>;
  resolveRequestContext: ResolveRequestContext;
  logger: Logger;
}

function toSandboxEnvironment({ environment, version }: SandboxEnvironmentWithVersion): SandboxEnvironment {
  const { type, sandbox_provider, ...manifest } = version.manifest;
  void type;
  void sandbox_provider;
  return {
    id: environment.id,
    name: environment.name,
    description: environment.description,
    lifecycle_stage: environment.lifecycle_stage,
    status: version.status,
    status_reason: version.status_reason,
    manifest: redactManifestSecrets(manifest),
    created_by_subject: environment.created_by_subject,
    created_at: environment.created_at,
    updated_at: environment.updated_at,
  };
}

/** Resolve the tenant sandbox provider record, if configured. */
async function resolveSandboxProviderRecord(
  providerStore: ISandboxProviderStore,
  tenant_id: string,
): Promise<SandboxProviderRecord | undefined> {
  return providerStore.getSandboxProvider(tenant_id);
}

function sandboxEnvironmentSecretHttpError(error: unknown): { status: 422 | 502; message: string } | undefined {
  if (!(error instanceof SandboxEnvironmentSecretSyncError)) {
    return undefined;
  }
  const authorizationMessage = getDaytonaAuthorizationErrorMessage(error.cause);
  if (authorizationMessage !== undefined) {
    return { status: 422, message: authorizationMessage };
  }
  const statusCode = error.cause instanceof DaytonaError ? error.cause.statusCode : undefined;
  if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
    return { status: 422, message: error.message };
  }
  return { status: 502, message: error.message };
}

/** CRUD for sandbox environments. */
export function createSandboxEnvironmentsRouter<TTransaction>(
  deps: SandboxEnvironmentsRouterDeps<TTransaction>,
): OpenAPIHono {
  const { sandboxEnvironmentStore: store, resolveAgentStore, resolveRequestContext, logger } = deps;

  const listHandler: RouteHandler<typeof listSandboxEnvironmentsRoute> = async c => {
    const { tenant_id, subject } = resolveRequestContext(c);
    const { limit, page_token: pageToken } = c.req.valid('query');
    try {
      const listed = await store.listEnvironments({
        tenant_id,
        created_by_subject_id: subject.id,
        limit,
        page_token: pageToken,
      });
      return c.json({ data: listed.data.map(toSandboxEnvironment), pagination: listed.pagination }, 200);
    } catch (error) {
      if (error instanceof InvalidPageTokenError) {
        return c.json({ error: { message: error.message } }, 400);
      }
      throw error;
    }
  };

  const getHandler: RouteHandler<typeof getSandboxEnvironmentRoute> = async c => {
    const { tenant_id, subject } = resolveRequestContext(c);
    const { name } = c.req.valid('param');
    // System default is tenant-wide; custom envs stay owner-scoped.
    const loaded = await store.getEnvironment({
      tenant_id,
      name,
      ...(name === DEFAULT_SANDBOX_ENVIRONMENT_NAME ? {} : { created_by_subject_id: subject.id }),
    });
    if (!loaded) {
      return c.json({ error: { message: `Sandbox environment not found: ${name}` } }, 404);
    }
    return c.json({ data: toSandboxEnvironment(loaded) }, 200);
  };

  // Create-or-update keyed by manifest.name.
  const putHandler: RouteHandler<typeof putSandboxEnvironmentRoute> = async c => {
    const body = c.req.valid('json');
    const requestContext = resolveRequestContext(c);
    const { manifest } = body;
    const provider = await resolveSandboxProviderRecord(deps.resolveSandboxProviderStore(c), requestContext.tenant_id);
    if (provider === undefined) {
      return c.json({ error: { message: 'No sandbox provider configured' } }, 422);
    }

    const created_by_subject = createdBySubjectFromRequestContext(requestContext);

    try {
      const existing = await store.getEnvironment({
        tenant_id: requestContext.tenant_id,
        name: manifest.name,
        created_by_subject_id: requestContext.subject.id,
      });
      const existingSecrets = existing
        ? await store.listSecretsByEnvironment({ environment_id: existing.environment.id })
        : [];
      const synced_secrets = await syncSandboxEnvironmentSecrets({
        secrets: manifest.networking?.secrets ?? [],
        previous: existing?.version.manifest.networking?.secrets ?? [],
        existing: existingSecrets,
        provider: toDaytonaSandboxProvider({
          manifest: provider.manifest,
          tenant_id: requestContext.tenant_id,
          logger,
        }),
        description: `Secret value of environment ${manifest.name}`,
      });

      const result = await store.upsertEnvironment({
        tenant_id: requestContext.tenant_id,
        name: manifest.name,
        description: manifest.description ?? '',
        created_by_subject,
        synced_secrets,
        buildVersion: ({ existing_version, existing_manifest, existing_external_ref }) =>
          Promise.resolve({
            ...buildNextVersion({
              ...(existing_version !== undefined ? { existing_version } : {}),
              ...(existing_manifest ? { previous_manifest: existing_manifest } : {}),
              ...(existing_external_ref ? { previous_external_ref: existing_external_ref } : {}),
              manifest,
              provider_type: provider.manifest.type,
            }),
            created_by_subject,
          }),
      });

      return c.json({ data: toSandboxEnvironment(result) }, 200);
    } catch (error) {
      if (error instanceof SandboxEnvironmentNameConflictError) {
        return c.json({ error: { message: error.message } }, 409);
      }
      if (error instanceof SandboxEnvironmentVersionConflictError) {
        return c.json({ error: { message: 'Sandbox environment was updated concurrently; retry' } }, 409);
      }
      if (error instanceof MissingStoredSecretError) {
        return c.json({ error: { message: 'Secret value is required' } }, 400);
      }
      const secretError = sandboxEnvironmentSecretHttpError(error);
      if (secretError !== undefined) {
        return c.json({ error: { message: secretError.message } }, secretError.status);
      }
      throw error;
    }
  };

  const deleteHandler: RouteHandler<typeof deleteSandboxEnvironmentRoute> = async c => {
    const { tenant_id, subject } = resolveRequestContext(c);
    const { name } = c.req.valid('param');
    if (name === DEFAULT_SANDBOX_ENVIRONMENT_NAME) {
      return c.json({ error: { message: 'Sandbox environment "default" cannot be deleted' } }, 409);
    }
    const existing = await store.getEnvironment({
      tenant_id,
      name,
      created_by_subject_id: subject.id,
    });
    if (!existing) {
      return c.json({ error: { message: `Sandbox environment not found: ${name}` } }, 404);
    }
    const agentNames = await resolveAgentStore(c).listAgentNamesUsingSandboxEnvironment({
      tenant_id,
      environment_name: name,
    });
    if (agentNames.length > 0) {
      return c.json(
        {
          error: {
            message: `Sandbox environment "${name}" is referenced by agent(s): ${agentNames.join(', ')}`,
          },
        },
        409,
      );
    }
    try {
      const secrets = await store.listSecretsByEnvironment({ environment_id: existing.environment.id });
      if (secrets.length > 0) {
        const provider = await resolveSandboxProviderRecord(deps.resolveSandboxProviderStore(c), tenant_id);
        if (provider === undefined) {
          return c.json({ error: { message: 'No sandbox provider configured' } }, 422);
        }
        await deleteSandboxEnvironmentSecrets({
          secrets,
          provider: toDaytonaSandboxProvider({ manifest: provider.manifest, tenant_id, logger }),
        });
      }
      await store.deleteEnvironment({
        tenant_id,
        name,
        created_by_subject_id: subject.id,
      });
      return c.json({}, 200);
    } catch (error) {
      const secretError = sandboxEnvironmentSecretHttpError(error);
      if (secretError !== undefined) {
        return c.json({ error: { message: secretError.message } }, secretError.status);
      }
      throw error;
    }
  };

  const router = new OpenAPIHono();
  router.openapi(listSandboxEnvironmentsRoute, listHandler);
  router.openapi(getSandboxEnvironmentRoute, getHandler);
  router.openapi(putSandboxEnvironmentRoute, putHandler);
  router.openapi(deleteSandboxEnvironmentRoute, deleteHandler);
  return router;
}
