/**
 * Sandbox environments API (mounted at /api/v1/sandbox-environments).
 * Real DB CRUD; OpenAPI / Fern registration intentionally deferred.
 * Snapshot builds are not started here — versions land in `created` for a future controller.
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import { InvalidPageTokenError } from '@truefoundry/trueforge-core/agent-session';
import type { Context } from 'hono';
import { createdBySubjectFromRequestContext, type ResolveRequestContext } from '../auth/identity';
import type { IAgentStore } from '../db/agentStore';
import {
  SandboxEnvironmentNameConflictError,
  SandboxEnvironmentVersionConflictError,
  type ISandboxEnvironmentStore,
  type SandboxEnvironmentWithVersion,
} from '../db/sandboxEnvironmentStore';
import type { ISandboxProviderStore, SandboxProviderRecord } from '../db/sandboxProviderStore';
import type { WithTransaction } from '../db/transaction';
import { buildNextVersion, redactManifestSecrets } from '../sandbox/sandboxEnvironmentVersion';
import { PAGE_LIMIT } from '../schemas/common';
import {
  UpdateSandboxEnvironmentRequestSchema,
  type SandboxEnvironment,
  type SandboxEnvironmentManifest,
  type StoredSandboxEnvironmentManifest,
} from '../schemas/sandboxEnvironment';
import { MissingStoredSecretError } from '../utils/secretRedaction';
import { zodErrorResponse } from '../zodErrorResponse';

export interface SandboxEnvironmentsRouterDeps<TTransaction> {
  sandboxEnvironmentStore: ISandboxEnvironmentStore<TTransaction>;
  resolveAgentStore: (c: Context) => IAgentStore<TTransaction>;
  resolveSandboxProviderStore: (c: Context) => ISandboxProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
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

async function validateJsonBody<T>(
  c: Context,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  const parsed = schema.safeParse(await c.req.json());
  if (!parsed.success) {
    return { ok: false, response: zodErrorResponse(c, parsed.error) };
  }
  return { ok: true, data: parsed.data };
}

function parseListQuery(c: Context): { limit: number; page_token: string | undefined } {
  const rawLimit = c.req.query('limit');
  const limit = rawLimit ? Number(rawLimit) : PAGE_LIMIT;
  return {
    limit: Number.isInteger(limit) && limit > 0 ? limit : PAGE_LIMIT,
    page_token: c.req.query('page_token'),
  };
}

/** Resolve the tenant sandbox provider record; callers pass it into versioning helpers. */
async function requireSandboxProviderRecord(
  providerStore: ISandboxProviderStore,
  tenant_id: string,
): Promise<SandboxProviderRecord | undefined> {
  return providerStore.getSandboxProvider(tenant_id);
}

function buildVersionForCreate({
  tenant_id,
  manifest,
  provider,
  created_by_subject,
}: {
  tenant_id: string;
  manifest: SandboxEnvironmentManifest;
  provider: SandboxProviderRecord;
  created_by_subject: ReturnType<typeof createdBySubjectFromRequestContext>;
}) {
  return {
    ...buildNextVersion({
      tenant_id,
      version: 1,
      manifest,
      provider_type: provider.manifest.type,
    }),
    created_by_subject,
  };
}

function buildVersionForUpdate({
  tenant_id,
  manifest,
  provider,
  created_by_subject,
  active_version,
  previous_manifest,
  previous_external_ref,
}: {
  tenant_id: string;
  manifest: SandboxEnvironmentManifest;
  provider: SandboxProviderRecord;
  created_by_subject: ReturnType<typeof createdBySubjectFromRequestContext>;
  active_version: number;
  previous_manifest: StoredSandboxEnvironmentManifest;
  previous_external_ref: string;
}) {
  return {
    ...buildNextVersion({
      tenant_id,
      version: active_version + 1,
      previous_manifest,
      previous_external_ref,
      manifest,
      provider_type: provider.manifest.type,
    }),
    created_by_subject,
  };
}

/** CRUD for sandbox environments (no OpenAPI registration yet). */
export function createSandboxEnvironmentsRouter<TTransaction>(
  deps: SandboxEnvironmentsRouterDeps<TTransaction>,
): OpenAPIHono {
  const router = new OpenAPIHono();
  const { sandboxEnvironmentStore: store, resolveAgentStore, withTransaction, resolveRequestContext } = deps;

  router.get('/', async c => {
    const { tenant_id, subject } = resolveRequestContext(c);
    const { limit, page_token } = parseListQuery(c);
    try {
      const listed = await store.listEnvironments({
        tenant_id,
        created_by_subject_id: subject.id,
        limit,
        page_token,
      });
      return c.json({ data: listed.data.map(toSandboxEnvironment), pagination: listed.pagination });
    } catch (error) {
      if (error instanceof InvalidPageTokenError) {
        return c.json({ error: { message: error.message } }, 400);
      }
      throw error;
    }
  });

  router.get('/:name', async c => {
    const { tenant_id, subject } = resolveRequestContext(c);
    const name = c.req.param('name');
    const loaded = await store.getEnvironment({
      tenant_id,
      name,
      created_by_subject_id: subject.id,
    });
    if (!loaded) {
      return c.json({ error: { message: `Sandbox environment not found: ${name}` } }, 404);
    }
    return c.json({ data: toSandboxEnvironment(loaded) });
  });

  router.put('/:name', async c => {
    const body = await validateJsonBody(c, UpdateSandboxEnvironmentRequestSchema);
    if (!body.ok) {
      return body.response;
    }
    const name = c.req.param('name');
    if (body.data.manifest.name !== name) {
      return c.json({ error: { message: 'Path name must match manifest.name' } }, 400);
    }
    const requestContext = resolveRequestContext(c);
    const provider = await requireSandboxProviderRecord(deps.resolveSandboxProviderStore(c), requestContext.tenant_id);
    if (!provider) {
      return c.json({ error: { message: 'No sandbox provider configured' } }, 422);
    }

    const created_by_subject = createdBySubjectFromRequestContext(requestContext);
    const { manifest } = body.data;

    try {
      const existing = await store.getEnvironment({
        tenant_id: requestContext.tenant_id,
        name,
        created_by_subject_id: requestContext.subject.id,
      });

      const result = existing
        ? await withTransaction(transaction =>
            store.updateEnvironment(
              {
                tenant_id: requestContext.tenant_id,
                id: existing.environment.id,
                description: manifest.description ?? '',
                buildVersion: previous =>
                  buildVersionForUpdate({
                    tenant_id: requestContext.tenant_id,
                    manifest,
                    provider,
                    created_by_subject,
                    ...previous,
                  }),
              },
              transaction,
            ),
          )
        : await withTransaction(transaction =>
            store.createEnvironment(
              {
                tenant_id: requestContext.tenant_id,
                name: manifest.name,
                description: manifest.description ?? '',
                created_by_subject,
                buildVersion: () =>
                  buildVersionForCreate({
                    tenant_id: requestContext.tenant_id,
                    manifest,
                    provider,
                    created_by_subject,
                  }),
              },
              transaction,
            ),
          );

      if (!result) {
        throw new Error(`Sandbox environment disappeared during update: ${name}`);
      }
      return c.json({ data: toSandboxEnvironment(result) });
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
  });

  router.delete('/:name', async c => {
    const { tenant_id, subject } = resolveRequestContext(c);
    const name = c.req.param('name');
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
      const listed = agentNames.slice(0, 5).join(', ');
      const more = agentNames.length > 5 ? ` (+${String(agentNames.length - 5)} more)` : '';
      return c.json(
        {
          error: {
            message: `Sandbox environment "${name}" is referenced by agent(s): ${listed}${more}`,
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
    return c.json({});
  });

  return router;
}
