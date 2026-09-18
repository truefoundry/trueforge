/**
 * Sandbox environments API (mounted at /api/v1/sandbox-environments).
 */
import { Daytona, DaytonaError } from '@daytona/sdk';
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { InvalidPageTokenError } from '@truefoundry/trueforge-core/agent-session';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createdBySubjectFromRequestContext, type ResolveRequestContext } from '../auth/identity';
import type { IAgentStore } from '../db/agentStore';
import {
  SandboxEnvironmentNameConflictError,
  type ISandboxEnvironmentStore,
  type SandboxEnvironmentRecord,
} from '../db/sandboxEnvironmentStore';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import type { WithTransaction } from '../db/transaction';
import {
  createSandboxEnvironmentRoute,
  deleteSandboxEnvironmentRoute,
  getSandboxEnvironmentRoute,
  listSandboxEnvironmentsRoute,
  putSandboxEnvironmentRoute,
} from '../routes/sandboxEnvironmentRoutes';
import { isDaytonaAuthError, isDaytonaPermissionError } from '../sandbox/providerUtils';
import type {
  CreateSandboxEnvironmentRequest,
  SandboxEnvironment,
  SandboxEnvironmentManifest,
  UpdateSandboxEnvironmentRequest,
} from '../schemas/sandboxEnvironment';

const SANDBOX_NOT_FOUND_STATUS = 404;

export interface SandboxEnvironmentsRouterDeps<TTransaction> {
  resolveSandboxEnvironmentStore: (c: Context) => ISandboxEnvironmentStore<TTransaction>;
  resolveSandboxProviderStore: (c: Context) => ISandboxProviderStore<TTransaction>;
  agentStore: IAgentStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  resolveRequestContext: ResolveRequestContext;
}

function toWire(record: SandboxEnvironmentRecord): SandboxEnvironment {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    manifest: record.manifest,
    created_by_subject: record.created_by_subject,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function isOwner(subjectId: string, record: SandboxEnvironmentRecord): boolean {
  return record.created_by_subject.subject_id === subjectId;
}

async function validateManifestAgainstProvider({
  manifest,
  tenant_id,
  sandboxProviderStore,
}: {
  manifest: SandboxEnvironmentManifest;
  tenant_id: string;
  sandboxProviderStore: ISandboxProviderStore;
}): Promise<void> {
  const provider = await sandboxProviderStore.getSandboxProvider(tenant_id);
  if (provider?.manifest.type !== 'daytona') {
    throw new HTTPException(422, {
      message: 'sandbox environments require a configured Daytona sandbox provider',
    });
  }
  if (manifest.provider !== provider.name) {
    throw new HTTPException(422, {
      message: `manifest.provider must match the configured sandbox provider ("${provider.name}")`,
    });
  }

  if (manifest.image.type === 'trueforge-default' && provider.status !== 'ready') {
    throw new HTTPException(422, {
      message: 'trueforge-default image requires the sandbox provider status to be ready',
    });
  }

  const daytona = new Daytona({ apiKey: provider.manifest.auth.api_key });

  if (manifest.image.type === 'snapshot') {
    try {
      await daytona.snapshot.get(manifest.image.name);
    } catch (error) {
      if (error instanceof DaytonaError && error.statusCode === SANDBOX_NOT_FOUND_STATUS) {
        throw new HTTPException(422, {
          message: `Daytona snapshot "${manifest.image.name}" was not found`,
          cause: error,
        });
      }
      if (isDaytonaAuthError(error)) {
        throw new HTTPException(422, {
          message: 'Daytona rejected the API key — check the credentials',
          cause: error,
        });
      }
      if (isDaytonaPermissionError(error)) {
        throw new HTTPException(422, {
          message: 'Daytona denied access while verifying the snapshot',
          cause: error,
        });
      }
      throw error;
    }
  }

  if (manifest.secrets) {
    const secretNames = [...new Set(Object.values(manifest.secrets))];
    try {
      for (const secretName of secretNames) {
        // Prefix match on Daytona today; require an exact name among results.
        const { items } = await daytona.secret.list({ name: secretName, limit: 200 });
        if (!items.some(secret => secret.name === secretName)) {
          throw new HTTPException(422, {
            message: `Daytona organization secret "${secretName}" was not found`,
          });
        }
      }
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }
      if (isDaytonaAuthError(error)) {
        throw new HTTPException(422, {
          message: 'Daytona rejected the API key — check the credentials',
          cause: error,
        });
      }
      if (isDaytonaPermissionError(error)) {
        throw new HTTPException(422, {
          message: 'Daytona denied access while verifying organization secrets',
          cause: error,
        });
      }
      throw error;
    }
  }
}

export function createSandboxEnvironmentsRouter<TTransaction>(deps: SandboxEnvironmentsRouterDeps<TTransaction>) {
  const listHandler: RouteHandler<typeof listSandboxEnvironmentsRoute> = async c => {
    const { limit, page_token: pageToken } = c.req.valid('query');
    const requestContext = deps.resolveRequestContext(c);
    try {
      const { data, pagination } = await deps.resolveSandboxEnvironmentStore(c).listSandboxEnvironments({
        tenant_id: requestContext.tenant_id,
        created_by_subject_id: requestContext.subject.id,
        limit,
        page_token: pageToken,
      });
      return c.json({ data: data.map(toWire), pagination }, 200);
    } catch (error) {
      if (error instanceof InvalidPageTokenError) {
        return c.json({ error: { message: error.message } }, 400);
      }
      throw error;
    }
  };

  const createHandler: RouteHandler<typeof createSandboxEnvironmentRoute> = async c => {
    const body: CreateSandboxEnvironmentRequest = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);
    try {
      await validateManifestAgainstProvider({
        manifest: body.manifest,
        tenant_id: requestContext.tenant_id,
        sandboxProviderStore: deps.resolveSandboxProviderStore(c),
      });
      const record = await deps.resolveSandboxEnvironmentStore(c).createSandboxEnvironment({
        tenant_id: requestContext.tenant_id,
        name: body.name,
        description: body.description ?? null,
        manifest: body.manifest,
        created_by_subject: createdBySubjectFromRequestContext(requestContext),
      });
      return c.json({ data: toWire(record) }, 201);
    } catch (error) {
      if (error instanceof SandboxEnvironmentNameConflictError) {
        return c.json({ error: { message: error.message } }, 409);
      }
      throw error;
    }
  };

  const getHandler: RouteHandler<typeof getSandboxEnvironmentRoute> = async c => {
    const { sandbox_environment_id: id } = c.req.valid('param');
    const requestContext = deps.resolveRequestContext(c);
    const record = await deps.resolveSandboxEnvironmentStore(c).getSandboxEnvironment({
      tenant_id: requestContext.tenant_id,
      id,
    });
    if (!record || !isOwner(requestContext.subject.id, record)) {
      return c.json({ error: { message: `Sandbox environment not found or you don't have access to it: ${id}` } }, 404);
    }
    return c.json({ data: toWire(record) }, 200);
  };

  const putHandler: RouteHandler<typeof putSandboxEnvironmentRoute> = async c => {
    const { sandbox_environment_id: id } = c.req.valid('param');
    const body: UpdateSandboxEnvironmentRequest = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);
    const existing = await deps.resolveSandboxEnvironmentStore(c).getSandboxEnvironment({
      tenant_id: requestContext.tenant_id,
      id,
    });
    if (!existing || !isOwner(requestContext.subject.id, existing)) {
      return c.json({ error: { message: `Sandbox environment not found or you don't have access to it: ${id}` } }, 404);
    }
    await validateManifestAgainstProvider({
      manifest: body.manifest,
      tenant_id: requestContext.tenant_id,
      sandboxProviderStore: deps.resolveSandboxProviderStore(c),
    });
    const record = await deps.resolveSandboxEnvironmentStore(c).updateSandboxEnvironment({
      tenant_id: requestContext.tenant_id,
      id,
      description: body.description,
      manifest: body.manifest,
    });
    if (!record) {
      return c.json({ error: { message: `Sandbox environment not found or you don't have access to it: ${id}` } }, 404);
    }
    return c.json({ data: toWire(record) }, 200);
  };

  const deleteHandler: RouteHandler<typeof deleteSandboxEnvironmentRoute> = async c => {
    const { sandbox_environment_id: id } = c.req.valid('param');
    const requestContext = deps.resolveRequestContext(c);
    const existing = await deps.resolveSandboxEnvironmentStore(c).getSandboxEnvironment({
      tenant_id: requestContext.tenant_id,
      id,
    });
    if (!existing || !isOwner(requestContext.subject.id, existing)) {
      return c.json({ error: { message: `Sandbox environment not found or you don't have access to it: ${id}` } }, 404);
    }
    const agentIds = await deps.agentStore.listAgentIdsUsingSandboxEnvironment({
      tenant_id: requestContext.tenant_id,
      environment_name: existing.name,
    });
    if (agentIds.length) {
      return c.json(
        {
          error: {
            message: `Sandbox environment "${existing.name}" is referenced by ${String(agentIds.length)} agent(s)`,
          },
        },
        409,
      );
    }
    await deps.resolveSandboxEnvironmentStore(c).deleteSandboxEnvironment({
      tenant_id: requestContext.tenant_id,
      id,
    });
    return c.json({}, 200);
  };

  const router = new OpenAPIHono();
  router.openapi(listSandboxEnvironmentsRoute, listHandler);
  router.openapi(createSandboxEnvironmentRoute, createHandler);
  router.openapi(getSandboxEnvironmentRoute, getHandler);
  router.openapi(putSandboxEnvironmentRoute, putHandler);
  router.openapi(deleteSandboxEnvironmentRoute, deleteHandler);
  return router;
}
