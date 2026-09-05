/**
 * Internal list-permissions API (mounted at /api/internal).
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { ISessionStore } from '@truefoundry/trueforge-core/agent-session';
import type { Context } from 'hono';
import type { Authorizer, GetPermissionsInput } from '../auth/authorizer';
import type { ResolveRequestContext } from '../auth/identity';
import type { IAgentStore } from '../db/agentStore';
import type { IScheduleStore } from '../db/scheduleStore';
import { listPermissionsRoute } from '../routes/permissionRoutes';
import type { ListPermissionsRequest } from '../schemas/permissions';

export interface PermissionsRouterDeps<TTransaction> {
  authorizer: Authorizer;
  resolveAgentStore: (c: Context) => IAgentStore<TTransaction>;
  scheduleStore: IScheduleStore<TTransaction>;
  sessionStore: ISessionStore;
  resolveRequestContext: ResolveRequestContext;
}

export function createPermissionsRouter<TTransaction>(deps: PermissionsRouterDeps<TTransaction>) {
  const listHandler: RouteHandler<typeof listPermissionsRoute> = async c => {
    const body: ListPermissionsRequest = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);
    const { resource_type: resourceType, resource_ids: resourceIds } = body;

    let input: GetPermissionsInput;
    if (resourceType === 'agent') {
      input = {
        resourceType: 'agent',
        requestContext,
        resourceIds,
        store: deps.resolveAgentStore(c),
      };
    } else if (resourceType === 'schedule') {
      input = {
        resourceType: 'schedule',
        requestContext,
        resourceIds,
        store: deps.scheduleStore,
      };
    } else {
      input = {
        resourceType: 'session',
        requestContext,
        resourceIds,
        store: deps.sessionStore,
      };
    }

    const data = await deps.authorizer.getPermissions(input);
    return c.json({ data }, 200);
  };

  const router = new OpenAPIHono();
  router.openapi(listPermissionsRoute, listHandler);
  return router;
}
