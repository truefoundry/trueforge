import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { extractErrorLogFields, isAuthRequired, McpConnectionError, RemoteMCP } from '@truefoundry/utils-core/core';
import type { Logger } from 'winston';
import type { McpStore } from '../legacy-registry-store/McpStore';
import { listMcpServersRoute, listMcpToolsRoute } from '../routes/legacyMcpRoutes';

export interface LegacyMcpRouterDeps {
  mcpStore: McpStore;
  logger: Logger;
}

/** Omits keys whose value is `undefined` so wire objects satisfy JSONValue index signatures. */
function omitUndefinedEntries(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

export function createLegacyMcpRouter(deps: LegacyMcpRouterDeps) {
  // auth_status here is a passive check only (no live refresh attempt); `authentication_required`
  // vs `not_required` — see route description.
  // TODO(mcp-dcr): once IMcpTokenStore lands, batch-check stored tokens for all DCR-configured
  // servers in one query instead of this config-only stub (never per-row — see db/postgres/AGENTS.md).
  const listMcpServersHandler: RouteHandler<typeof listMcpServersRoute> = c => {
    const data = deps.mcpStore.list().map(entry => ({
      ...entry,
      auth_status: entry.auth ? ('authentication_required' as const) : ('not_required' as const),
    }));
    return c.json({ data }, 200);
  };

  // Live MCP `tools/list` call against the configured server, no selectors applied.
  const listMcpToolsHandler: RouteHandler<typeof listMcpToolsRoute> = async c => {
    const { name } = c.req.valid('param');
    const entry = deps.mcpStore.get(name);
    if (!entry) {
      return c.json({ error: { message: `MCP server not found: ${name}` } }, 404);
    }
    const remote = new RemoteMCP({
      id: name,
      name,
      url: entry.url,
      headers: deps.mcpStore.getHeaders(name),
      logger: deps.logger,
      signal: c.req.raw.signal,
    });
    try {
      const response = await remote.listTools();
      if (isAuthRequired(response)) {
        return c.json({ error: { message: `MCP server "${name}" requires authentication` } }, 401);
      }
      const data = response.result.tools.map(tool => omitUndefinedEntries({ ...tool }));
      return c.json({ data }, 200);
    } catch (error) {
      if (error instanceof McpConnectionError) {
        deps.logger.warn(`MCP tools/list failed for "${name}"`, extractErrorLogFields(error));
        if (error.statusCode === 401) {
          return c.json({ error: { message: error.message } }, 401);
        }
        return c.json({ error: { message: error.message } }, 502);
      }
      throw error;
    }
  };

  const router = new OpenAPIHono();
  router.openapi(listMcpServersRoute, listMcpServersHandler);
  router.openapi(listMcpToolsRoute, listMcpToolsHandler);
  return router;
}
