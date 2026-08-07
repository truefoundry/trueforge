/**
 * DB-backed agent registry API (mounted at /api/v1/agents).
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { AgentSpec } from '@truefoundry/utils-core/agent-session';
import { AgentNameConflictError, type AgentRecord, type IAgentStore } from '../db/agentStore';
import type { IMcpServerStore } from '../db/mcpServerStore';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import type { ISkillStore } from '../db/skillStore';
import type { WithTransaction } from '../db/transaction';
import {
  createAgentRoute,
  deleteAgentRoute,
  getAgentRoute,
  listAgentsRoute,
  putAgentRoute,
} from '../routes/agentRoutes';
import { validateAgentSpec } from '../runtime/sessionResources';
import { toAgentManifest, type Agent, type AgentWriteRequest } from '../schemas/agent';
import { TENANT_ID } from './sessions';

export interface AgentsRouterDeps<TTransaction> {
  agentStore: IAgentStore<TTransaction>;
  modelProviderStore: IModelProviderStore<TTransaction>;
  mcpServerStore: IMcpServerStore<TTransaction>;
  skillStore: ISkillStore<TTransaction>;
  sandboxProviderStore: ISandboxProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
}

/** Wire view: identity columns plus AgentSpec fields flattened. */
function toWireAgent(record: AgentRecord): Agent {
  return {
    id: record.id,
    name: record.name,
    ...record.manifest,
  };
}

async function validateManifest<TTransaction>({
  spec,
  deps,
}: {
  spec: AgentSpec;
  deps: AgentsRouterDeps<TTransaction>;
}): Promise<AgentSpec> {
  await validateAgentSpec({
    spec,
    tenant_id: TENANT_ID,
    modelProviderStore: deps.modelProviderStore,
    mcpServerStore: deps.mcpServerStore,
    skillStore: deps.skillStore,
    sandboxProviderStore: deps.sandboxProviderStore,
  });
  return spec;
}

export function createAgentsRouter<TTransaction>(deps: AgentsRouterDeps<TTransaction>) {
  const listHandler: RouteHandler<typeof listAgentsRoute> = async c => {
    const records = await deps.agentStore.listAgents(TENANT_ID);
    return c.json({ data: records.map(toWireAgent) }, 200);
  };

  const createHandler: RouteHandler<typeof createAgentRoute> = async c => {
    const body: AgentWriteRequest = c.req.valid('json');
    const manifest = await validateManifest({ spec: toAgentManifest(body), deps });
    try {
      const record = await deps.agentStore.createAgent({
        tenant_id: TENANT_ID,
        name: body.name,
        manifest,
      });
      return c.json({ data: toWireAgent(record) }, 200);
    } catch (error) {
      if (error instanceof AgentNameConflictError) {
        return c.json({ error: { message: error.message } }, 409);
      }
      throw error;
    }
  };

  const getHandler: RouteHandler<typeof getAgentRoute> = async c => {
    const { agent_id: agentId } = c.req.valid('param');
    const record = await deps.agentStore.getAgent({ tenant_id: TENANT_ID, id: agentId });
    if (record === undefined) {
      return c.json({ error: { message: `Agent not found: ${agentId}` } }, 404);
    }
    return c.json({ data: toWireAgent(record) }, 200);
  };

  const deleteHandler: RouteHandler<typeof deleteAgentRoute> = async c => {
    const { agent_id: agentId } = c.req.valid('param');
    await deps.agentStore.deleteAgent({ tenant_id: TENANT_ID, id: agentId });
    return c.body(null, 204);
  };

  const putHandler: RouteHandler<typeof putAgentRoute> = async c => {
    const { name } = c.req.valid('param');
    const body = c.req.valid('json');
    const manifest = await validateManifest({ spec: body, deps });
    const record = await deps.agentStore.updateAgent({
      tenant_id: TENANT_ID,
      name,
      manifest,
    });
    if (record === undefined) {
      return c.json({ error: { message: `Agent not found: ${name}` } }, 404);
    }
    return c.json({ data: toWireAgent(record) }, 200);
  };

  const router = new OpenAPIHono();
  router.openapi(listAgentsRoute, listHandler);
  router.openapi(createAgentRoute, createHandler);
  router.openapi(getAgentRoute, getHandler);
  router.openapi(deleteAgentRoute, deleteHandler);
  router.openapi(putAgentRoute, putHandler);
  return router;
}
