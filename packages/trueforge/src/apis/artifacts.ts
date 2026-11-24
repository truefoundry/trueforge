import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { InvalidPageTokenError } from '@truefoundry/trueforge-core/agent-session';
import { HTTPException } from 'hono/http-exception';
import type { ResolveRequestContext } from '../auth/identity';
import type { ArtifactRecord, IArtifactStore } from '../db/artifactStore';
import { getArtifactRoute, listArtifactsRoute, updateArtifactRoute } from '../routes/artifactRoutes';
import type { Artifact } from '../schemas/artifact';

export interface ArtifactsRouterDeps {
  artifactStore: IArtifactStore;
  resolveRequestContext: ResolveRequestContext;
}

function toWireArtifact(record: ArtifactRecord): Artifact {
  return {
    id: record.id,
    name: record.name,
    latest_version: record.latest_version,
    entry_point: record.latest_entry_point,
    created_by_subject: record.created_by_subject,
    created_by_session_id: record.created_by_session_id,
    created_by_agent_id: record.created_by_agent_id,
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
        created_by_session_id: query.created_by_session_id,
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

  const getHandler: RouteHandler<typeof getArtifactRoute> = async c => {
    const { artifact_id } = c.req.valid('param');
    const requestContext = deps.resolveRequestContext(c);
    const artifact = await deps.artifactStore.getArtifact({
      tenant_id: requestContext.tenant_id,
      id: artifact_id,
      created_by_subject_id: requestContext.subject.id,
    });
    if (artifact === undefined) {
      throw new HTTPException(404, { message: `Artifact not found: ${artifact_id}` });
    }
    return c.json({ data: toWireArtifact(artifact) }, 200);
  };

  const updateHandler: RouteHandler<typeof updateArtifactRoute> = async c => {
    const { artifact_id } = c.req.valid('param');
    const { name } = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);
    let updated: ArtifactRecord | undefined;
    try {
      updated = await deps.artifactStore.updateArtifact({
        tenant_id: requestContext.tenant_id,
        id: artifact_id,
        created_by_subject_id: requestContext.subject.id,
        name,
      });
    } catch (error) {
      if (error instanceof RangeError) {
        throw new HTTPException(400, { message: error.message, cause: error });
      }
      throw error;
    }
    if (updated === undefined) {
      throw new HTTPException(404, { message: `Artifact not found: ${artifact_id}` });
    }
    return c.json({ data: toWireArtifact(updated) }, 200);
  };

  const router = new OpenAPIHono();
  router.openapi(listArtifactsRoute, listHandler);
  router.openapi(getArtifactRoute, getHandler);
  router.openapi(updateArtifactRoute, updateHandler);
  return router;
}
