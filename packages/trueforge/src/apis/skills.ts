import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { ResolveRequestContext } from '../auth/identity';
import { SkillNameConflictError, type ISkillStore, type SkillRecord } from '../db/skillStore';
import type { WithTransaction } from '../db/transaction';
import {
  createSkillRoute,
  listAvailableSkillsRoute,
  listConfiguredSkillsRoute,
  listSkillVersionsRoute,
  putSkillRoute,
} from '../routes/skillRoutes';
import type { AvailableSkill, ConfiguredSkill, CreateSkillRequest, UpdateSkillRequest } from '../schemas/skill';
import { RegistrySkillManifestSchema } from '../schemas/skill';

export type ResolveSkillStore<TTransaction = never> = (c: Context) => ISkillStore<TTransaction>;

export interface SkillsRouterDeps<TTransaction> {
  resolveSkillStore: ResolveSkillStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  resolveRequestContext: ResolveRequestContext;
}

function toConfiguredSkill(record: SkillRecord): ConfiguredSkill {
  return {
    name: record.name,
    manifest: record.manifest,
  };
}

function toAvailableSkill(record: SkillRecord): AvailableSkill {
  const { manifest } = record;
  if (manifest.type === 'registry') {
    const registry = RegistrySkillManifestSchema.parse(manifest);
    return {
      // Attach name is the version FQN; artifact name is display_name.
      name: registry.fqn,
      display_name: registry.name,
      description: registry.description,
      skill_repo_name: registry.skill_repo_name,
      version: registry.version,
    };
  }
  return { name: record.name, description: manifest.description };
}

/** Admin/settings skills CRUD (mounted at /api/v1/settings/skills). */
export function createSkillsRouter<TTransaction>(deps: SkillsRouterDeps<TTransaction>) {
  const listConfiguredHandler: RouteHandler<typeof listConfiguredSkillsRoute> = async c => {
    const requestContext = deps.resolveRequestContext(c);
    const records = await deps.resolveSkillStore(c).listSkills({
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
      const record = await deps.resolveSkillStore(c).createSkill({
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
    const record = await deps.resolveSkillStore(c).upsertSkill({
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
export function createAvailableSkillsRouter<TTransaction>(deps: SkillsRouterDeps<TTransaction>) {
  const router = new OpenAPIHono();
  router.openapi(listAvailableSkillsRoute, async c => {
    const requestContext = deps.resolveRequestContext(c);
    const records = await deps.resolveSkillStore(c).listSkills({
      tenant_id: requestContext.tenant_id,
      names: undefined,
    });
    return c.json({ data: records.map(toAvailableSkill) }, 200);
  });

  router.openapi(listSkillVersionsRoute, async c => {
    const { name } = c.req.valid('query');
    return c.json({ data: await deps.resolveSkillStore(c).listSkillVersions({ name }) }, 200);
  });

  return router;
}
