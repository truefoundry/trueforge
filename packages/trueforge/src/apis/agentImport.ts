/**
 * Internal bulk agent import under /api/internal/import.
 * Per agent: createAgent → created; name conflict → exists; other errors → failed.
 * tenant_id and created_by_subject come from each item (not from the bearer session).
 * Uses the request agent store (TrueFoundry mode syncs a new SF agent with source=trueforge).
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  AgentExternalIdConflictError,
  AgentNameConflictError,
  type IAgentStore,
} from '../db/agentStore';
import { importAgentsRoute } from '../routes/agentImportRoutes';
import type { ImportAgentItemResult } from '../schemas/agentImport';

export interface AgentImportRouterDeps {
  resolveAgentStore: (c: Context) => IAgentStore;
}

export function createAgentImportRouter(deps: AgentImportRouterDeps) {
  const router = new OpenAPIHono();

  const importHandler: RouteHandler<typeof importAgentsRoute> = async c => {
    const { agents } = c.req.valid('json');
    const agentStore = deps.resolveAgentStore(c);

    const results: ImportAgentItemResult[] = [];
    for (const agent of agents) {
      try {
        const record = await agentStore.createAgent({
          tenant_id: agent.tenant_id,
          name: agent.name,
          manifest: agent.manifest,
          external_id: null,
          created_by_subject: agent.created_by_subject,
        });
        results.push({
          name: record.name,
          tenant_id: agent.tenant_id,
          status: 'created',
          agent_id: record.id,
        });
      } catch (error) {
        if (error instanceof AgentNameConflictError || error instanceof AgentExternalIdConflictError) {
          results.push({ name: agent.name, tenant_id: agent.tenant_id, status: 'exists' });
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        results.push({ name: agent.name, tenant_id: agent.tenant_id, status: 'failed', error: message });
      }
    }

    return c.json({ data: { results } }, 200);
  };

  router.openapi(importAgentsRoute, importHandler);
  return router;
}
