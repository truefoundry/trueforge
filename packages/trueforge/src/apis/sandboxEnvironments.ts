/**
 * Sandbox environments API (mounted at /api/v1/sandbox-environments).
 * Snapshot builds are not started here — versions land in `pending` for a future controller.
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { InvalidPageTokenError } from '@truefoundry/trueforge-core/agent-session';
import type { Context } from 'hono';
import { createdBySubjectFromRequestContext, type ResolveRequestContext } from '../auth/identity';
import { isTrueFoundryModeEnabled } from '../config';
import type { IAgentStore } from '../db/agentStore';
import {
  SandboxEnvironmentNameConflictError,
  SandboxEnvironmentVersionConflictError,
  type ISandboxEnvironmentStore,
  type SandboxEnvironmentWithVersion,
  type UpsertSandboxEnvironmentPrevious,
} from '../db/sandboxEnvironmentStore';
import type { ISandboxProviderStore, SandboxProviderRecord } from '../db/sandboxProviderStore';
import {
  deleteSandboxEnvironmentRoute,
  getSandboxEnvironmentRoute,
  listSandboxEnvironmentsRoute,
  putSandboxEnvironmentRoute,
} from '../routes/sandboxEnvironmentRoutes';
import { buildNextVersion, redactManifestSecrets } from '../sandbox/sandboxEnvironmentVersion';
import type { SandboxEnvironment, SandboxEnvironmentManifest } from '../schemas/sandboxEnvironment';
import { MissingStoredSecretError } from '../utils/secretRedaction';

export interface SandboxEnvironmentsRouterDeps<TTransaction> {
  sandboxEnvironmentStore: ISandboxEnvironmentStore<TTransaction>;
  resolveAgentStore: (c: Context) => IAgentStore<TTransaction>;
  resolveSandboxProviderStore: (c: Context) => ISandboxProviderStore<TTransaction>;
  resolveRequestContext: ResolveRequestContext;
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

function buildUpsertVersion({
  manifest,
  created_by_subject,
  previous,
}: {
  manifest: SandboxEnvironmentManifest;
  created_by_subject: ReturnType<typeof createdBySubjectFromRequestContext>;
  previous?: UpsertSandboxEnvironmentPrevious;
}) {
  // Label follows platform mode; create/build always use Daytona credentials + code.
  return {
    ...buildNextVersion({
      version: previous ? previous.latest_version + 1 : 1,
      ...(previous
        ? {
            previous_manifest: previous.previous_manifest,
            previous_external_ref: previous.previous_external_ref,
          }
        : {}),
      manifest,
      provider_type: isTrueFoundryModeEnabled() ? 'truefoundry' : 'daytona',
    }),
    created_by_subject,
  };
}

/** CRUD for sandbox environments. */
export function createSandboxEnvironmentsRouter<TTransaction>(
  deps: SandboxEnvironmentsRouterDeps<TTransaction>,
): OpenAPIHono {
  const { sandboxEnvironmentStore: store, resolveAgentStore, resolveRequestContext } = deps;

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
    const loaded = await store.getEnvironment({
      tenant_id,
      name,
      created_by_subject_id: subject.id,
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
    const provider = await resolveSandboxProviderRecord(deps.resolveSandboxProviderStore(c), requestContext.tenant_id);
    if (provider?.manifest.type !== 'daytona') {
      return c.json({ error: { message: 'Sandbox environments require a Daytona sandbox provider' } }, 422);
    }

    const created_by_subject = createdBySubjectFromRequestContext(requestContext);
    const { manifest } = body;

    try {
      const result = await store.upsertEnvironment({
        tenant_id: requestContext.tenant_id,
        name: manifest.name,
        description: manifest.description ?? '',
        created_by_subject,
        buildVersion: previous =>
          buildUpsertVersion({
            manifest,
            created_by_subject,
            ...(previous ? { previous } : {}),
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
      throw error;
    }
  };

  const deleteHandler: RouteHandler<typeof deleteSandboxEnvironmentRoute> = async c => {
    const { tenant_id, subject } = resolveRequestContext(c);
    const { name } = c.req.valid('param');
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
    await store.deleteEnvironment({
      tenant_id,
      name,
      created_by_subject_id: subject.id,
    });
    return c.json({}, 200);
  };

  const router = new OpenAPIHono();
  router.openapi(listSandboxEnvironmentsRoute, listHandler);
  router.openapi(getSandboxEnvironmentRoute, getHandler);
  router.openapi(putSandboxEnvironmentRoute, putHandler);
  router.openapi(deleteSandboxEnvironmentRoute, deleteHandler);
  return router;
}
