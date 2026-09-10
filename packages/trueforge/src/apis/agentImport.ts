/**
 * Internal import under /api/internal/import (agents + sessions + checkpoint).
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { ISessionStore } from '@truefoundry/trueforge-core/agent-session';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  AgentExternalIdConflictError,
  AgentNameConflictError,
  type IAgentStore,
} from '../db/agentStore';
import { PostgresSessionStore } from '../db/postgres/session-store/PostgresSessionStore';
import {
  getImportSessionsCheckpointRoute,
  importAgentsRoute,
  importSessionRoute,
} from '../routes/agentImportRoutes';
import type { ImportAgentItemResult } from '../schemas/agentImport';
import {
  TFY_ASSUME_USER_HEADER,
  tenantSystemAssumeUserHeader,
} from '../truefoundry/TrueFoundryServiceFoundryServerClient';

export interface AgentImportRouterDeps {
  resolveAgentStore: (c: Context) => IAgentStore;
  sessionStore: ISessionStore;
  /** Builds TrueFoundryAgentStore with SF client constructor assume-user headers. */
  createImportAgentStore?: (headers: Record<string, string>) => IAgentStore;
}

function errorDetail(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return error.stack ? `${error.message}\n${error.stack}` : error.message;
}

export function createAgentImportRouter(deps: AgentImportRouterDeps) {
  const router = new OpenAPIHono();

  const importAgentsHandler: RouteHandler<typeof importAgentsRoute> = async c => {
    const { agents } = c.req.valid('json');

    const results: ImportAgentItemResult[] = [];
    for (const agent of agents) {
      try {
        const agentStore =
          deps.createImportAgentStore?.({
            [TFY_ASSUME_USER_HEADER]: tenantSystemAssumeUserHeader(agent.tenant_id),
          }) ?? deps.resolveAgentStore(c);

        const created = await agentStore.createAgent({
          tenant_id: agent.tenant_id,
          name: agent.name,
          manifest: agent.manifest,
          external_id: null,
          created_by_subject: agent.created_by_subject,
        });
        results.push({
          name: created.name,
          tenant_id: agent.tenant_id,
          status: 'created',
          agent_id: created.id,
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

  const importSessionHandler: RouteHandler<typeof importSessionRoute> = async c => {
    if (!(deps.sessionStore instanceof PostgresSessionStore)) {
      throw new HTTPException(500, {
        message: 'Session import requires Postgres (STANDALONE=false)',
      });
    }
    const body = c.req.valid('json');
    try {
      const result = await deps.sessionStore.importSessionSnapshot(body);
      if (!result.imported) {
        return c.json({ data: result }, 409);
      }
      return c.json({ data: result }, 201);
    } catch (error) {
      throw new HTTPException(500, { message: errorDetail(error), cause: error });
    }
  };

  const checkpointHandler: RouteHandler<typeof getImportSessionsCheckpointRoute> = async c => {
    if (!(deps.sessionStore instanceof PostgresSessionStore)) {
      throw new HTTPException(500, {
        message: 'Session import requires Postgres (STANDALONE=false)',
      });
    }
    const { tenant_id } = c.req.valid('query');
    try {
      const data = await deps.sessionStore.getImportSessionsCheckpoint({ tenant_id });
      return c.json({ data }, 200);
    } catch (error) {
      throw new HTTPException(500, { message: errorDetail(error), cause: error });
    }
  };

  router.openapi(importAgentsRoute, importAgentsHandler);
  router.openapi(importSessionRoute, importSessionHandler);
  router.openapi(getImportSessionsCheckpointRoute, checkpointHandler);
  return router;
}
