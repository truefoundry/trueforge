/**
 * Internal API for the sandbox-environment build controller.
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
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
    const pending = await deps.sandboxEnvironmentStore.listLatestPendingVersions();
    return c.json(
      {
        data: pending.map(environment_version_id => ({ environment_version_id })),
      },
      200,
    );
  };

  const progressHandler: RouteHandler<typeof progressSandboxEnvironmentVersionRoute> = async c => {
    const body = c.req.valid('json');
    try {
      await progressSandboxEnvironmentVersion({
        sandboxEnvironmentStore: deps.sandboxEnvironmentStore,
        sandboxProviderStore: deps.sandboxProviderStore,
        environment_version_id: body.environment_version_id,
        logger: deps.logger,
      });
      return c.body(null, 204);
    } catch (error) {
      if (error instanceof HTTPException && error.status === 404) {
        return c.json({ error: { message: 'Sandbox environment version not found' } }, 404);
      }
      throw error;
    }
  };

  const router = new OpenAPIHono();
  router.openapi(listPendingSandboxEnvironmentVersionsRoute, listHandler);
  router.openapi(progressSandboxEnvironmentVersionRoute, progressHandler);
  return router;
}
