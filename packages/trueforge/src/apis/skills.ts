import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { ResolveRequestContext } from '../auth/identity';
import { SkillNameConflictError, type ISkillStore, type SkillRecord } from '../db/skillStore';
import type { WithTransaction } from '../db/transaction';
import {
  createSkillRoute,
  listAvailableSkillsRoute,
  listConfiguredSkillsRoute,
  putSkillRoute,
} from '../routes/skillRoutes';
import type { ConfiguredSkill, CreateSkillRequest, UpdateSkillRequest } from '../schemas/skill';

export interface SkillsRouterDeps<TTransaction> {
  skillStore: ISkillStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  resolveRequestContext: ResolveRequestContext;
}

/** Wire view of a stored skill: identity `name` plus nested manifest. */
function toConfiguredSkill(record: SkillRecord): ConfiguredSkill {
  return {
    name: record.name,
    manifest: record.manifest,
  };
}

/** Admin/settings skills CRUD (mounted at /api/v1/settings/skills). */
export function createSkillsRouter<TTransaction>(deps: SkillsRouterDeps<TTransaction>) {
  const listConfiguredHandler: RouteHandler<typeof listConfiguredSkillsRoute> = async c => {
    const requestContext = deps.resolveRequestContext(c);
    const records = await deps.skillStore.listSkills({
      tenant_id: requestContext.tenant_id,
      names: undefined,
    });
    return c.json({ data: records.map(toConfiguredSkill) }, 200);
  };

  const createHandler: RouteHandler<typeof createSkillRoute> = async c => {
    const body: CreateSkillRequest = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);
    const manifest = body.manifest;
    try {
      const record = await deps.skillStore.createSkill({
        tenant_id: requestContext.tenant_id,
        name: manifest.name,
        manifest,
      });
      return c.json({ data: toConfiguredSkill(record) }, 201);
    } catch (error) {
      if (error instanceof SkillNameConflictError) {
        return c.json({ error: { message: error.message } }, 409);
      }
      throw error;
    }
  };

  const putHandler: RouteHandler<typeof putSkillRoute> = async c => {
    const body: UpdateSkillRequest = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);
    const manifest = body.manifest;
    const record = await deps.skillStore.upsertSkill({
      tenant_id: requestContext.tenant_id,
      name: manifest.name,
      manifest,
    });
    return c.json({ data: toConfiguredSkill(record) }, 200);
  };

  const router = new OpenAPIHono();
  router.openapi(listConfiguredSkillsRoute, listConfiguredHandler);
  router.openapi(createSkillRoute, createHandler);
  router.openapi(putSkillRoute, putHandler);
  return router;
}

/** Chat slim list (mounted at /api/v1/skills) — mirrors GET /api/v1/mcp-servers. */
export function createAvailableSkillsRouter<TTransaction>(deps: {
  skillStore: ISkillStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  resolveRequestContext: ResolveRequestContext;
}) {
  const router = new OpenAPIHono();
  router.openapi(listAvailableSkillsRoute, async c => {
    const requestContext = deps.resolveRequestContext(c);
    const records = await deps.skillStore.listSkills({
      tenant_id: requestContext.tenant_id,
      names: undefined,
    });
    return c.json(
      {
        data: records.map(record => ({
          name: record.name,
          description: record.manifest.description,
        })),
      },
      200,
    );
  });
  return router;
}
