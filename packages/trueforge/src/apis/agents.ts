/**
 * DB-backed agent registry API (mounted at /api/v1/agents).
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { AgentSpec } from '@truefoundry/trueforge-core/agent-session';
import type { Context } from 'hono';
import { createdBySubjectFromRequestContext, type ResolveRequestContext } from '../auth/identity';
import { AgentNameConflictError, type AgentRecord, type IAgentStore } from '../db/agentStore';
import type { IMcpServerStore } from '../db/mcpServerStore';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import type { ISkillStore } from '../db/skillStore';
import type { WithTransaction } from '../db/transaction';
import {
  createAgentRoute,
  deleteAgentRoute,
  getAgentCodeSnippetsRoute,
  getAgentRoute,
  listAgentsRoute,
  putAgentRoute,
} from '../routes/agentRoutes';
import { validateAgentSpec } from '../runtime/sessionResources';
import { type Agent, type CreateAgentRequest } from '../schemas/agent';
import { buildAgentCodeSnippets } from './agentCodeSnippets';

export interface AgentsRouterDeps<TTransaction> {
  agentStore: IAgentStore<TTransaction>;
  resolveModelProviderStore: (c: Context) => IModelProviderStore<TTransaction>;
  resolveMcpServerStore: (c: Context) => IMcpServerStore<TTransaction>;
  skillStore: ISkillStore<TTransaction>;
  sandboxProviderStore: ISandboxProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  resolveRequestContext: ResolveRequestContext;
}

/** Wire view: identity columns plus nested manifest. */
function toWireAgent(record: AgentRecord): Agent {
  return {
    id: record.id,
    name: record.name,
    manifest: record.manifest,
    created_by_subject: record.created_by_subject,
  };
}

async function validateManifest<TTransaction>({
  spec,
  deps,
  modelProviderStore,
  mcpServerStore,
  tenant_id,
}: {
  spec: AgentSpec;
  deps: AgentsRouterDeps<TTransaction>;
  modelProviderStore: IModelProviderStore<TTransaction>;
  mcpServerStore: IMcpServerStore<TTransaction>;
  tenant_id: string;
}): Promise<AgentSpec> {
  await validateAgentSpec({
    spec,
    tenant_id,
    modelProviderStore,
    mcpServerStore,
    skillStore: deps.skillStore,
    sandboxProviderStore: deps.sandboxProviderStore,
  });
  return spec;
}

export function createAgentsRouter<TTransaction>(deps: AgentsRouterDeps<TTransaction>) {
  const listHandler: RouteHandler<typeof listAgentsRoute> = async c => {
    const requestContext = deps.resolveRequestContext(c);
    const records = await deps.agentStore.listAgents(requestContext.tenant_id);
    return c.json({ data: records.map(toWireAgent) }, 200);
  };

  const createHandler: RouteHandler<typeof createAgentRoute> = async c => {
    const body: CreateAgentRequest = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);
    const manifest = await validateManifest({
      spec: body.manifest,
      deps,
      modelProviderStore: deps.resolveModelProviderStore(c),
      mcpServerStore: deps.resolveMcpServerStore(c),
      tenant_id: requestContext.tenant_id,
    });
    try {
      const record = await deps.agentStore.createAgent({
        tenant_id: requestContext.tenant_id,
        name: body.name,
        manifest,
        external_id: null,
        created_by_subject: createdBySubjectFromRequestContext(requestContext),
      });
      return c.json({ data: toWireAgent(record) }, 201);
    } catch (error) {
      if (error instanceof AgentNameConflictError) {
        return c.json({ error: { message: error.message } }, 409);
      }
      throw error;
    }
  };

  const getHandler: RouteHandler<typeof getAgentRoute> = async c => {
    const { agent_id: agentId } = c.req.valid('param');
    const requestContext = deps.resolveRequestContext(c);
    const record = await deps.agentStore.getAgent({
      tenant_id: requestContext.tenant_id,
      id: agentId,
    });
    if (record === undefined) {
      return c.json({ error: { message: `Agent not found: ${agentId}` } }, 404);
    }
    return c.json({ data: toWireAgent(record) }, 200);
  };

  const getCodeSnippetsHandler: RouteHandler<typeof getAgentCodeSnippetsRoute> = async c => {
    const { agent_id: agentId } = c.req.valid('param');
    const requestContext = deps.resolveRequestContext(c);
    const record = await deps.agentStore.getAgent({
      tenant_id: requestContext.tenant_id,
      id: agentId,
    });
    if (record === undefined) {
      return c.json({ error: { message: `Agent not found: ${agentId}` } }, 404);
    }
    return c.json(
      {
        data: buildAgentCodeSnippets({
          agentName: record.name,
          baseUrl: new URL(c.req.url).origin,
        }),
      },
      200,
    );
  };

  const deleteHandler: RouteHandler<typeof deleteAgentRoute> = async c => {
    const { agent_id: agentId } = c.req.valid('param');
    const requestContext = deps.resolveRequestContext(c);
    await deps.agentStore.deleteAgent({ tenant_id: requestContext.tenant_id, id: agentId });
    return c.json({}, 200);
  };

  const putHandler: RouteHandler<typeof putAgentRoute> = async c => {
    const { agent_id: agentId } = c.req.valid('param');
    const body = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);
    const manifest = await validateManifest({
      spec: body.manifest,
      deps,
      modelProviderStore: deps.resolveModelProviderStore(c),
      mcpServerStore: deps.resolveMcpServerStore(c),
      tenant_id: requestContext.tenant_id,
    });
    const record = await deps.agentStore.updateAgent({
      tenant_id: requestContext.tenant_id,
      id: agentId,
      manifest,
    });
    if (record === undefined) {
      return c.json({ error: { message: `Agent not found: ${agentId}` } }, 404);
    }
    return c.json({ data: toWireAgent(record) }, 200);
  };

  const router = new OpenAPIHono();
  router.openapi(listAgentsRoute, listHandler);
  router.openapi(createAgentRoute, createHandler);
  router.openapi(getAgentCodeSnippetsRoute, getCodeSnippetsHandler);
  router.openapi(getAgentRoute, getHandler);
  router.openapi(deleteAgentRoute, deleteHandler);
  router.openapi(putAgentRoute, putHandler);
  return router;
}
