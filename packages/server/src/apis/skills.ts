import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { SkillNameConflictError, type ISkillStore, type SkillRecord } from '../db/skillStore';
import type { WithTransaction } from '../db/transaction';
import {
  createSkillRoute,
  listAvailableSkillsRoute,
  listConfiguredSkillsRoute,
  putSkillRoute,
} from '../routes/skillRoutes';
import type { ConfiguredSkill, SkillManifest } from '../schemas/skill';
import { TENANT_ID } from './sessions';

export interface SkillsRouterDeps<TTransaction> {
  skillStore: ISkillStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
}

/** Wire view of a stored skill: identity `name` plus persisted manifest. */
function toConfiguredSkill(record: SkillRecord): ConfiguredSkill {
  return {
    ...record.manifest,
    name: record.name,
  };
}

/** Admin/settings skills CRUD (mounted at /api/v1/settings/skills). */
export function createSkillsRouter<TTransaction>(deps: SkillsRouterDeps<TTransaction>) {
  const listConfiguredHandler: RouteHandler<typeof listConfiguredSkillsRoute> = async c => {
    const records = await deps.skillStore.listSkills({ tenant_id: TENANT_ID, names: undefined });
    return c.json({ data: records.map(toConfiguredSkill) }, 200);
  };

  const createHandler: RouteHandler<typeof createSkillRoute> = async c => {
    const manifest: SkillManifest = c.req.valid('json');
    try {
      const record = await deps.skillStore.createSkill({
        tenant_id: TENANT_ID,
        name: manifest.name,
        manifest,
      });
      return c.json({ data: toConfiguredSkill(record) }, 200);
    } catch (error) {
      if (error instanceof SkillNameConflictError) {
        return c.json({ error: { message: error.message } }, 409);
      }
      throw error;
    }
  };

  const putHandler: RouteHandler<typeof putSkillRoute> = async c => {
    const manifest: SkillManifest = c.req.valid('json');
    const record = await deps.skillStore.upsertSkill({
      tenant_id: TENANT_ID,
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
}) {
  const router = new OpenAPIHono();
  router.openapi(listAvailableSkillsRoute, async c => {
    const records = await deps.skillStore.listSkills({ tenant_id: TENANT_ID, names: undefined });
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
