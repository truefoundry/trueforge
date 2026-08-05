import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import {
  ensureMcpClientRegistered,
  extractErrorLogFields,
  type IOAuthTokenStore,
  isAuthRequired,
  isMcpAuthRequired,
  McpConnectionError,
  McpDcrConfigurationError,
  type OAuthToken,
  RemoteMCP,
  resolveMcpAuth,
  validateRedirectUris,
  withTimeout,
} from '@truefoundry/utils-core/core';
import { HTTPException } from 'hono/http-exception';
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
import { getMcpConnection } from '../runtime/sessionResources';
import type { ConfiguredMcpServer, McpAuthStatus, McpServerManifest } from '../schemas/mcpServer';
import { resolveMcpAuthStatus } from '../schemas/mcpServer';
import { TENANT_ID } from './sessions';

/** Registering a DCR OAuth client hits the MCP server's authorization server, so bound that call. */
export const MCP_DCR_REGISTRATION_TIMEOUT_MS = 10_000;

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

/**
 * `token` is the DCR access token stored for this server (keyed by `record.id`), or undefined for
 * header/no-auth servers and DCR servers that have never authorized. Only DCR reads it.
 */
function toConfiguredMcpServer({
  record,
  token,
  nowMs = Date.now(),
}: {
  record: McpServerRecord;
  token: OAuthToken | undefined;
  nowMs?: number;
}): ConfiguredMcpServer {
  return {
    ...record.manifest,
    auth_status: resolveMcpAuthStatus({
      manifest: record.manifest,
      ...(token !== undefined ? { token } : {}),
      nowMs,
    }),
  };
}

/** Admin/settings MCP CRUD (mounted at /api/v1/settings/mcp-servers).
 *  TODO: Remove the server via txn if DCR fails to register
 */
export function createMcpServersRouter(deps: McpServersRouterDeps) {
  const registerDcrClient = async (params: {
    serverId: string;
    mcpServerUrl: string;
    mcpServerName: string;
  }): Promise<void> => {
    await withTimeout(
      ensureMcpClientRegistered({
        mcpServerStore: deps.mcpServerStore,
        serverId: params.serverId,
        mcpServerUrl: params.mcpServerUrl,
        mcpServerName: params.mcpServerName,
        clientName: configuration.OAUTH_CLIENT_NAME,
      }),
      MCP_DCR_REGISTRATION_TIMEOUT_MS,
      `DCR client registration for MCP server "${params.mcpServerName}"`,
    );
  };

  const catalogHandler: RouteHandler<typeof getMcpServerCatalogRoute> = c => {
    return c.json({ data: [...deps.mcpCatalog.list()] }, 200);
  };

  const listConfiguredHandler: RouteHandler<typeof listConfiguredMcpServersRoute> = async c => {
    const records = await deps.mcpServerStore.listServers(TENANT_ID);
    const nowMs = Date.now();
    // Only DCR servers have tokens; batch the lookup.
    const dcrIds = records.filter(record => record.manifest.auth?.type === 'dcr').map(record => record.id);
    const tokens = await deps.tokenStore.getTokens({ ids: dcrIds });
    return c.json(
      { data: records.map(record => toConfiguredMcpServer({ record, token: tokens.get(record.id), nowMs })) },
      200,
    );
  };

  const putHandler: RouteHandler<typeof putMcpServerRoute> = async c => {
    const manifest: McpServerManifest = c.req.valid('json');
    const record = await deps.mcpServerStore.upsertServer({
      tenant_id: TENANT_ID,
      name: manifest.name,
      manifest,
    });
    if (record.manifest.auth?.type === 'dcr') {
      try {
        await registerDcrClient({
          serverId: record.id,
          mcpServerUrl: record.manifest.url,
          mcpServerName: record.manifest.name,
        });
      } catch (error) {
        // Permanent config error (server advertises no DCR support): a retry can never succeed, so
        // surface it now as a 400 for immediate feedback instead of a silently-broken server.
        if (error instanceof McpDcrConfigurationError) {
          deps.logger.error(
            `DCR misconfiguration for "${record.manifest.name}"; rejecting upsert`,
            extractErrorLogFields(error),
          );
          return c.json({ error: { message: error.message } }, 400);
        }
        // Transient (network / timeout / flaky authorization server): keep the saved server and let
        // the next authorize retry, rather than failing the upsert on a temporary fault.
        deps.logger.warn(
          `Eager DCR client registration failed for "${record.manifest.name}"; will retry on authorize`,
          extractErrorLogFields(error),
        );
      }
    }
    // A re-upsert preserves `id`, so a DCR server may already carry a token from a prior authorize.
    const token = record.manifest.auth?.type === 'dcr' ? await deps.tokenStore.getToken({ id: record.id }) : undefined;
    return c.json({ data: toConfiguredMcpServer({ record, token }) }, 200);
  };

  const listToolsHandler: RouteHandler<typeof listMcpServerToolsRoute> = async c => {
    const { name } = c.req.valid('param');
    // Same url + header resolution as turn execution (DCR via resolveMcpAuth, header/no-auth static).
    let connection;
    try {
      connection = await getMcpConnection({
        tenant_id: TENANT_ID,
        name,
        store: deps.mcpServerStore,
        tokenStore: deps.tokenStore,
        clientName: configuration.OAUTH_CLIENT_NAME,
      });
    } catch (error) {
      // getMcpConnection throws HTTPException(400) for unknown names; settings wire uses 404.
      if (error instanceof HTTPException && error.status === 400) {
        return c.json({ error: { message: `MCP server not found: ${name}` } }, 404);
      }
      throw error;
    }
    const remote = new RemoteMCP({
      id: name,
      name,
      url: connection.url,
      headers: connection.headers,
      requestTimeoutMs: configuration.MCP_REQUEST_TIMEOUT_MS,
      connectTimeoutMs: configuration.MCP_CONNECT_TIMEOUT_MS,
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

    if (record.manifest.auth?.type !== 'dcr') {
      return c.json(resolveMcpAuthStatus({ manifest: record.manifest }), 200);
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
      const authStatus: McpAuthStatus = isMcpAuthRequired(result)
        ? { status: 'auth_required', authorization_url: result.authUrl.href }
        : { status: 'authenticated' };
      return c.json(authStatus, 200);
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
