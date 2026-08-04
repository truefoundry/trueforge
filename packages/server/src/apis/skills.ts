import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { SkillCatalog } from '../catalog/SkillCatalog';
import type { ISkillStore, SkillRecord } from '../db/skillStore';
import {
  getSkillCatalogRoute,
  listAvailableSkillsRoute,
  listConfiguredSkillsRoute,
  putSkillRoute,
} from '../routes/skillRoutes';
import type { ConfiguredSkill, SkillManifest } from '../schemas/skill';
import { TENANT_ID } from './sessions';

export interface SkillsRouterDeps {
  skillCatalog: SkillCatalog;
  skillStore: ISkillStore;
}

/** Wire view of a stored skill: identity `name` plus persisted manifest. */
function toConfiguredSkill(record: SkillRecord): ConfiguredSkill {
  return {
    ...record.manifest,
    name: record.name,
  };
}

/** Admin/settings skills CRUD (mounted at /api/v1/settings/skills). */
export function createSkillsRouter(deps: SkillsRouterDeps) {
  const catalogHandler: RouteHandler<typeof getSkillCatalogRoute> = c => {
    return c.json({ data: [...deps.skillCatalog.list()] }, 200);
  };

  const listConfiguredHandler: RouteHandler<typeof listConfiguredSkillsRoute> = async c => {
    const records = await deps.skillStore.listSkills(TENANT_ID);
    return c.json({ data: records.map(toConfiguredSkill) }, 200);
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
  // Static `/catalog` before `/` so path order matches model-providers / mcp-servers.
  router.openapi(getSkillCatalogRoute, catalogHandler);
  router.openapi(listConfiguredSkillsRoute, listConfiguredHandler);
  router.openapi(putSkillRoute, putHandler);
  return router;
}

/** Chat slim list (mounted at /api/v1/skills) — mirrors GET /api/v1/mcp-servers. */
export function createAvailableSkillsRouter(store: ISkillStore) {
  const router = new OpenAPIHono();
  router.openapi(listAvailableSkillsRoute, async c => {
    const records = await store.listSkills(TENANT_ID);
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
