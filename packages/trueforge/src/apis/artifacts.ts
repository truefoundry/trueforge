import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { InvalidPageTokenError } from '@truefoundry/trueforge-core/agent-session';
import { HTTPException } from 'hono/http-exception';
import type { ResolveRequestContext } from '../auth/identity';
import type { ArtifactRecord, IArtifactStore } from '../db/artifactStore';
import { listArtifactsRoute } from '../routes/artifactRoutes';
import type { Artifact } from '../schemas/artifact';

export interface ArtifactsRouterDeps {
  artifactStore: IArtifactStore;
  resolveRequestContext: ResolveRequestContext;
}

function toWireArtifact(record: ArtifactRecord): Artifact {
  return {
    id: record.id,
    name: record.name,
    created_by_subject: record.created_by_subject,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export function createArtifactsRouter(deps: ArtifactsRouterDeps) {
  const listHandler: RouteHandler<typeof listArtifactsRoute> = async c => {
    const query = c.req.valid('query');
    const requestContext = deps.resolveRequestContext(c);
    try {
      const { data, pagination } = await deps.artifactStore.listArtifacts({
        tenant_id: requestContext.tenant_id,
        created_by_subject_id: requestContext.subject.id,
        name: query.name,
        limit: query.limit,
        page_token: query.page_token,
      });
      return c.json({ data: data.map(toWireArtifact), pagination }, 200);
    } catch (error) {
      if (error instanceof InvalidPageTokenError) {
        throw new HTTPException(400, { message: error.message, cause: error });
      }
      throw error;
    }
  };

  const router = new OpenAPIHono();
  router.openapi(listArtifactsRoute, listHandler);
  return router;
}
