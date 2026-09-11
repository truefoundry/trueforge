/**
 * DB-backed agent registry API (mounted at /api/v1/agents).
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { AgentSpec } from '@truefoundry/trueforge-core/agent-session';
import type { Context } from 'hono';
import type { Authorizer } from '../auth/authorizer';
import { createdBySubjectFromRequestContext, type ResolveRequestContext } from '../auth/identity';
import configuration from '../config';
import {
  AgentExternalIdConflictError,
  AgentNameConflictError,
  type AgentRecord,
  type IAgentStore,
} from '../db/agentStore';
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
import { agentIfAccessible, listAccessibleAgents } from './agentAccess';
import { buildAgentCodeSnippets } from './agentCodeSnippets';
import type { ResolveSkillStore } from './skills';

export interface AgentsRouterDeps<TTransaction> {
  resolveAgentStore: (c: Context) => IAgentStore<TTransaction>;
  resolveModelProviderStore: (c: Context) => IModelProviderStore<TTransaction>;
  resolveMcpServerStore: (c: Context) => IMcpServerStore<TTransaction>;
  resolveSkillStore: ResolveSkillStore<TTransaction>;
  resolveSandboxProviderStore: (c: Context) => ISandboxProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  resolveRequestContext: ResolveRequestContext;
  authorizer: Authorizer;
}

/** Wire view: identity columns plus nested manifest. */
function toWireAgent(record: AgentRecord): Agent {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    manifest: record.manifest,
    created_by_subject: record.created_by_subject,
  };
}

async function validateManifest<TTransaction>({
  spec,
  modelProviderStore,
  mcpServerStore,
  skillStore,
  sandboxProviderStore,
  tenant_id,
}: {
  spec: AgentSpec;
  modelProviderStore: IModelProviderStore<TTransaction>;
  mcpServerStore: IMcpServerStore<TTransaction>;
  skillStore: ISkillStore<TTransaction>;
  sandboxProviderStore: ISandboxProviderStore<TTransaction>;
  tenant_id: string;
}): Promise<AgentSpec> {
  await validateAgentSpec({
    spec,
    tenant_id,
    modelProviderStore,
    mcpServerStore,
    skillStore,
    sandboxProviderStore,
  });
  return spec;
}

export function createAgentsRouter<TTransaction>(deps: AgentsRouterDeps<TTransaction>) {
  const listHandler: RouteHandler<typeof listAgentsRoute> = async c => {
    const requestContext = deps.resolveRequestContext(c);
    const records = await listAccessibleAgents({
      store: deps.resolveAgentStore(c),
      context: requestContext,
      authorizer: deps.authorizer,
      action: 'read',
    });
    return c.json({ data: records.map(toWireAgent) }, 200);
  };

  const createHandler: RouteHandler<typeof createAgentRoute> = async c => {
    const body: CreateAgentRequest = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);
    const manifest = await validateManifest({
      spec: body.manifest,
      modelProviderStore: deps.resolveModelProviderStore(c),
      mcpServerStore: deps.resolveMcpServerStore(c),
      skillStore: deps.resolveSkillStore(c),
      sandboxProviderStore: deps.resolveSandboxProviderStore(c),
      tenant_id: requestContext.tenant_id,
    });
    try {
      const record = await deps.resolveAgentStore(c).createAgent({
        tenant_id: requestContext.tenant_id,
        name: body.name,
        description: body.description,
        manifest,
        external_id: null,
        created_by_subject: createdBySubjectFromRequestContext(requestContext),
      });
      return c.json({ data: toWireAgent(record) }, 201);
    } catch (error) {
      if (error instanceof AgentNameConflictError || error instanceof AgentExternalIdConflictError) {
        return c.json({ error: { message: error.message } }, 409);
      }
      throw error;
    }
  };

  const getHandler: RouteHandler<typeof getAgentRoute> = async c => {
    const { agent_id: agentId } = c.req.valid('param');
    const requestContext = deps.resolveRequestContext(c);
    const record = await agentIfAccessible({
      authorizer: deps.authorizer,
      context: requestContext,
      action: 'read',
      agent: await deps.resolveAgentStore(c).getAgent({ tenant_id: requestContext.tenant_id, id: agentId }),
    });
    if (record === undefined) {
      return c.json({ error: { message: `Agent not found: ${agentId}` } }, 404);
    }
    return c.json({ data: toWireAgent(record) }, 200);
  };

  const getCodeSnippetsHandler: RouteHandler<typeof getAgentCodeSnippetsRoute> = async c => {
    const { agent_id: agentId } = c.req.valid('param');
    const requestContext = deps.resolveRequestContext(c);
    const record = await agentIfAccessible({
      authorizer: deps.authorizer,
      context: requestContext,
      action: 'read',
      agent: await deps.resolveAgentStore(c).getAgent({ tenant_id: requestContext.tenant_id, id: agentId }),
    });
    if (record === undefined) {
      return c.json({ error: { message: `Agent not found: ${agentId}` } }, 404);
    }
    // Prefer FE-supplied public URL (avoids in-cluster Host). Else request origin + PUBLIC_BASE_URL path.
    // e.g. origin https://sample.com + PUBLIC_BASE_URL https://example.com/trueforge
    //   → https://sample.com/trueforge
    const requestedBaseUrl = c.req.valid('query').base_url;
    const origin = new URL(c.req.url).origin;
    let baseUrl = origin;
    if (requestedBaseUrl) {
      baseUrl = requestedBaseUrl;
    } else if (configuration.PUBLIC_BASE_URL) {
      baseUrl = new URL(new URL(configuration.PUBLIC_BASE_URL).pathname, origin).href;
    }
    return c.json(
      {
        data: buildAgentCodeSnippets({
          agentName: record.name,
          baseUrl,
        }),
      },
      200,
    );
  };

  const deleteHandler: RouteHandler<typeof deleteAgentRoute> = async c => {
    const { agent_id: agentId } = c.req.valid('param');
    const requestContext = deps.resolveRequestContext(c);
    const existing = await agentIfAccessible({
      authorizer: deps.authorizer,
      context: requestContext,
      action: 'delete',
      agent: await deps.resolveAgentStore(c).getAgent({ tenant_id: requestContext.tenant_id, id: agentId }),
    });
    if (existing === undefined) {
      return c.json({ error: { message: `Agent not found: ${agentId}` } }, 404);
    }
    await deps.resolveAgentStore(c).deleteAgent({ tenant_id: requestContext.tenant_id, id: agentId });
    return c.json({}, 200);
  };

  const putHandler: RouteHandler<typeof putAgentRoute> = async c => {
    const { agent_id: agentId } = c.req.valid('param');
    const body = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);
    const existing = await agentIfAccessible({
      authorizer: deps.authorizer,
      context: requestContext,
      action: 'manage',
      agent: await deps.resolveAgentStore(c).getAgent({ tenant_id: requestContext.tenant_id, id: agentId }),
    });
    if (existing === undefined) {
      return c.json({ error: { message: `Agent not found: ${agentId}` } }, 404);
    }
    const manifest = await validateManifest({
      spec: body.manifest,
      modelProviderStore: deps.resolveModelProviderStore(c),
      mcpServerStore: deps.resolveMcpServerStore(c),
      skillStore: deps.resolveSkillStore(c),
      sandboxProviderStore: deps.resolveSandboxProviderStore(c),
      tenant_id: requestContext.tenant_id,
    });
    const record = await deps.resolveAgentStore(c).updateAgent({
      tenant_id: requestContext.tenant_id,
      id: agentId,
      ...(body.description === undefined ? {} : { description: body.description }),
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
