/**
 * Admin session snapshot import under /api/v1/settings/sessions.
 * Postgres-only; returns 501 when no importer is wired (standalone).
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import type { ISessionSnapshotImporter } from '../db/sessionSnapshotImport';
import { importSessionSnapshotRoute } from '../routes/sessionImportRoutes';

export interface SessionImportRouterDeps {
  sessionSnapshotImporter: ISessionSnapshotImporter | undefined;
}

export function createSessionImportRouter(deps: SessionImportRouterDeps) {
  const router = new OpenAPIHono();

  const importHandler: RouteHandler<typeof importSessionSnapshotRoute> = async c => {
    if (deps.sessionSnapshotImporter === undefined) {
      throw new HTTPException(501, {
        message: 'Session import requires Postgres (STANDALONE=false)',
      });
    }
    const body = c.req.valid('json');
    const result = await deps.sessionSnapshotImporter.importSessionSnapshot(body);
    return c.json({ data: result }, result.imported ? 201 : 200);
  };

  router.openapi(importSessionSnapshotRoute, importHandler);
  return router;
}
