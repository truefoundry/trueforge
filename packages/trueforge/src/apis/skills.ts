import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { ResolveRequestContext } from '../auth/identity';
import type { AgentRecord } from '../db/agentStore';
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
import { parseTrueFoundryRegistrySkill } from '../schemas/skill';

export type ResolveSkillStore<TTransaction = never> = (
  rc: Context,
  runAsAgent?: AgentRecord,
) => ISkillStore<TTransaction>;

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
  const registry = parseTrueFoundryRegistrySkill(manifest);
  if (registry !== undefined) {
    return {
      name: record.name,
      description: registry.description,
      metadata: {
        display_name: registry.display_name,
        repository_name: registry.repository_name,
        version: String(registry.version),
      },
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
    const { manifest } = body;
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
    const { manifest } = body;
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

/** Chat slim list (mounted at /api/v1/skills). */
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
    const skillVersions = await deps.resolveSkillStore(c).listSkillVersions({ name });
    return c.json({ data: skillVersions }, 200);
  });

  return router;
}
