import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { InvalidPageTokenError } from '@truefoundry/trueforge-core/agent-session';
import { HTTPException } from 'hono/http-exception';
import type { ResolveRequestContext } from '../auth/identity';
import type { ArtifactRecord, IArtifactStore } from '../db/artifactStore';
import { getArtifactRoute, listArtifactsRoute } from '../routes/artifactRoutes';
import type { Artifact } from '../schemas/artifact';

export interface ArtifactsRouterDeps<TTransaction> {
  artifactStore: IArtifactStore<TTransaction>;
  resolveRequestContext: ResolveRequestContext;
}

function toWireArtifact(record: ArtifactRecord): Artifact {
  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    latest_version: record.latest_version,
    created_by_subject: record.created_by_subject,
    created_by_session_id: record.created_by_session_id,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export function createArtifactsRouter<TTransaction>(deps: ArtifactsRouterDeps<TTransaction>) {
  const listHandler: RouteHandler<typeof listArtifactsRoute> = async c => {
    const { limit, page_token } = c.req.valid('query');
    const requestContext = deps.resolveRequestContext(c);
    try {
      const { data, pagination } = await deps.artifactStore.listArtifacts({
        tenant_id: requestContext.tenant_id,
        limit,
        page_token,
      });
      return c.json({ data: data.map(toWireArtifact), pagination }, 200);
    } catch (error) {
      if (error instanceof InvalidPageTokenError) {
        throw new HTTPException(400, { message: error.message, cause: error });
      }
      throw error;
    }
  };

  const getHandler: RouteHandler<typeof getArtifactRoute> = async c => {
    const { slug } = c.req.valid('param');
    const requestContext = deps.resolveRequestContext(c);
    const artifact = await deps.artifactStore.getArtifact({ tenant_id: requestContext.tenant_id, slug });
    if (artifact === undefined) {
      return c.json({ error: { message: `Artifact not found: ${slug}` } }, 404);
    }
    return c.json({ data: toWireArtifact(artifact) }, 200);
  };

  const router = new OpenAPIHono();
  router.openapi(listArtifactsRoute, listHandler);
  router.openapi(getArtifactRoute, getHandler);
  return router;
}
