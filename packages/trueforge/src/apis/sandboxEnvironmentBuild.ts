/**
 * Internal API for the sandbox-environment build controller.
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Logger } from 'winston';
import type { ISandboxEnvironmentStore } from '../db/sandboxEnvironmentStore';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import {
  listPendingSandboxEnvironmentVersionsRoute,
  progressSandboxEnvironmentVersionRoute,
} from '../routes/sandboxEnvironmentBuildRoutes';
import { progressSandboxEnvironmentVersion } from '../sandbox/progressSandboxEnvironmentVersion';

export interface SandboxEnvironmentBuildRouterDeps {
  sandboxEnvironmentStore: ISandboxEnvironmentStore;
  sandboxProviderStore: ISandboxProviderStore;
  logger: Logger;
}

export function createSandboxEnvironmentBuildRouter(deps: SandboxEnvironmentBuildRouterDeps) {
  const listHandler: RouteHandler<typeof listPendingSandboxEnvironmentVersionsRoute> = async c => {
    const { limit } = c.req.valid('query');
    const pending = await deps.sandboxEnvironmentStore.listLatestPendingVersions({ limit });
    return c.json(
      {
        data: pending.map(row => ({
          tenant_id: row.tenant_id,
          environment_id: row.environment_id,
          environment_name: row.environment_name,
          version: row.version,
          external_ref: row.external_ref,
        })),
      },
      200,
    );
  };

  const progressHandler: RouteHandler<typeof progressSandboxEnvironmentVersionRoute> = async c => {
    const body = c.req.valid('json');
    const result = await progressSandboxEnvironmentVersion({
      sandboxEnvironmentStore: deps.sandboxEnvironmentStore,
      sandboxProviderStore: deps.sandboxProviderStore,
      environment_id: body.environment_id,
      version: body.version,
      logger: deps.logger,
    });
    if (result === 'not_found') {
      return c.json({ error: { message: 'Sandbox environment version not found' } }, 404);
    }
    return c.body(null, 204);
  };

  const router = new OpenAPIHono();
  router.openapi(listPendingSandboxEnvironmentVersionsRoute, listHandler);
  router.openapi(progressSandboxEnvironmentVersionRoute, progressHandler);
  return router;
}
