import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import {
  extractErrorLogFields,
  isAuthRequired,
  isMcpAuthRequired,
  McpConnectionError,
  RemoteMCP,
  resolveMcpAuth,
  validateRedirectUris,
  type IOAuthTokenStore,
} from '@truefoundry/utils-core/core';
import type { Logger } from 'winston';
import type { McpCatalog } from '../catalog/McpCatalog';
import configuration from '../config';
import type { IMcpServerStore, McpServerRecord } from '../db/mcpServerStore';
import {
  authorizeConfiguredMcpServerRoute,
  getMcpServerCatalogRoute,
  listAvailableMcpServersRoute,
  listConfiguredMcpServersRoute,
  listMcpServerToolsRoute,
  putMcpServerRoute,
} from '../routes/mcpServerRoutes';
import type { ConfiguredMcpServer, McpServerManifest } from '../schemas/mcpServer';
import { resolveConfiguredMcpRequestHeaders, toStubAuthStatus } from '../schemas/mcpServer';
import { TENANT_ID } from './sessions';

export interface McpServersRouterDeps {
  mcpCatalog: McpCatalog;
  mcpServerStore: IMcpServerStore;
  tokenStore: IOAuthTokenStore;
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

function toConfiguredMcpServer(record: McpServerRecord): ConfiguredMcpServer {
  return {
    ...record.manifest,
    auth_status: toStubAuthStatus(record.manifest),
  };
}

/** Admin/settings MCP CRUD (mounted at /api/v1/settings/mcp-servers). */
export function createMcpServersRouter(deps: McpServersRouterDeps) {
  const catalogHandler: RouteHandler<typeof getMcpServerCatalogRoute> = c => {
    return c.json({ data: [...deps.mcpCatalog.list()] }, 200);
  };

  const listConfiguredHandler: RouteHandler<typeof listConfiguredMcpServersRoute> = async c => {
    const records = await deps.mcpServerStore.listServers(TENANT_ID);
    return c.json({ data: records.map(toConfiguredMcpServer) }, 200);
  };

  const putHandler: RouteHandler<typeof putMcpServerRoute> = async c => {
    const manifest: McpServerManifest = c.req.valid('json');
    const record = await deps.mcpServerStore.upsertServer({
      tenant_id: TENANT_ID,
      name: manifest.name,
      manifest,
    });
    return c.json({ data: toConfiguredMcpServer(record) }, 200);
  };

  const listToolsHandler: RouteHandler<typeof listMcpServerToolsRoute> = async c => {
    const { name } = c.req.valid('param');
    const record = await deps.mcpServerStore.getServer({ tenant_id: TENANT_ID, name });
    if (!record) {
      return c.json({ error: { message: `MCP server not found: ${name}` } }, 404);
    }
    const remote = new RemoteMCP({
      id: name,
      name,
      url: record.manifest.url,
      headers: resolveConfiguredMcpRequestHeaders(record.manifest),
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

  const authorizeHandler: RouteHandler<typeof authorizeConfiguredMcpServerRoute> = async c => {
    const { name } = c.req.valid('param');
    const { redirect_url: redirectUrl } = c.req.valid('query');
    const record = await deps.mcpServerStore.getServer({ tenant_id: TENANT_ID, name });
    if (!record) {
      return c.json({ error: { message: `MCP server not found: ${name}` } }, 404);
    }
    // Header auth (and no auth): credentials already on the row — no browser flow.
    if (record.manifest.auth?.type !== 'dcr') {
      return c.json({ status: 'authenticated' as const }, 200);
    }
    try {
      if (redirectUrl) {
        validateRedirectUris({ redirectUris: [redirectUrl] });
      }
      // Reuses a usable/refreshable token when present; only builds an auth URL when needed.
      const result = await resolveMcpAuth({
        tokenStore: deps.tokenStore,
        mcpServerStore: deps.mcpServerStore,
        serverId: record.id,
        mcpServerUrl: record.manifest.url,
        mcpServerName: record.name,
        clientName: configuration.OAUTH_CLIENT_NAME,
        ...(redirectUrl !== undefined ? { redirectUrl } : {}),
      });
      if (isMcpAuthRequired(result)) {
        return c.json({ status: 'auth_required' as const, authorization_url: result.authUrl.href }, 200);
      }
      return c.json({ status: 'authenticated' as const }, 200);
    } catch (error) {
      if (error instanceof McpConnectionError) {
        deps.logger.warn(`MCP authorize failed for "${name}"`, extractErrorLogFields(error));
        if (error.statusCode === 400) {
          return c.json({ error: { message: error.message } }, 400);
        }
        return c.json({ error: { message: error.message } }, 500);
      }
      deps.logger.error(`MCP authorize unexpected failure for "${name}"`, extractErrorLogFields(error));
      return c.json({ error: { message: 'Internal server error' } }, 500);
    }
  };

  const router = new OpenAPIHono();
  // Static `/catalog` before `/{name}/…` so "catalog" is not captured as a name.
  router.openapi(getMcpServerCatalogRoute, catalogHandler);
  router.openapi(listConfiguredMcpServersRoute, listConfiguredHandler);
  router.openapi(putMcpServerRoute, putHandler);
  router.openapi(listMcpServerToolsRoute, listToolsHandler);
  router.openapi(authorizeConfiguredMcpServerRoute, authorizeHandler);
  return router;
}

/** Chat slim list (mounted at /api/v1/mcp-servers) — mirrors GET /api/v1/models. */
export function createAvailableMcpServersRouter(store: IMcpServerStore) {
  const router = new OpenAPIHono();
  router.openapi(listAvailableMcpServersRoute, async c => {
    const records = await store.listServers(TENANT_ID);
    return c.json(
      {
        data: records.map(record => ({ name: record.name, url: record.manifest.url })),
      },
      200,
    );
  });
  return router;
}
