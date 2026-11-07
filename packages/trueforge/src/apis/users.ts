/** Tenant users API (mounted at /api/v1/users). */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { InvalidPageTokenError } from '@truefoundry/trueforge-core/agent-session';
import {
  decodeOffsetPageToken,
  encodeOffsetPageToken,
} from '@truefoundry/trueforge-core/agent-session/store/OffsetPageToken';
import { HTTPException } from 'hono/http-exception';
import type { ResolveRequestContext } from '../auth/identity';
import type { IUserStore } from '../db/userStore';
import { listUsersRoute } from '../routes/userRoutes';

export interface UsersRouterDeps {
  userStore: IUserStore;
  resolveRequestContext: ResolveRequestContext;
}

function decodeOffset(pageToken: string | undefined): number {
  try {
    return decodeOffsetPageToken(pageToken);
  } catch (error) {
    if (error instanceof InvalidPageTokenError) {
      throw new HTTPException(400, { message: error.message, cause: error });
    }
    throw error;
  }
}

export function createUsersRouter(deps: UsersRouterDeps): OpenAPIHono {
  const listUsersHandler: RouteHandler<typeof listUsersRoute> = async c => {
    const { query, limit, page_token: pageToken, ids } = c.req.valid('query');
    const context = deps.resolveRequestContext(c);
    if (ids !== undefined) {
      const users = await deps.userStore.getUsersByIds({ context, ids });
      return c.json({ data: users, pagination: { limit: ids.length } }, 200);
    }
    const offset = decodeOffset(pageToken);
    const { data, total } = await deps.userStore.listUsers({
      context,
      query,
      limit,
      offset,
    });
    const nextOffset = offset + data.length;
    return c.json(
      {
        data,
        pagination: {
          limit,
          ...(data.length > 0 && nextOffset < total ? { next_page_token: encodeOffsetPageToken(nextOffset) } : {}),
          ...(offset > 0 ? { previous_page_token: encodeOffsetPageToken(Math.max(0, offset - limit)) } : {}),
        },
      },
      200,
    );
  };

  const router = new OpenAPIHono();
  router.openapi(listUsersRoute, listUsersHandler);
  return router;
}
