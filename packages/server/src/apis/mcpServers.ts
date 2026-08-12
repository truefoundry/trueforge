import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { extractErrorLogFields, isAuthRequired, McpConnectionError, RemoteMCP } from '@truefoundry/utils-core/core';
import type { Logger } from 'winston';
import type { ResolveUserContext } from '../auth/identity';
import type { McpCatalog } from '../catalog/McpCatalog';
import configuration from '../config';
import type { IMcpServerStore, McpServerRecord } from '../db/mcpServerStore';
import type { WithTransaction } from '../db/transaction';
import { createMcpOAuthClient, isMcpAuthRequired, resolveMcpAuth } from '../mcp/auth/mcpDcr';
import { mcpOAuthCallbackUrl, validateRedirectUris } from '../mcp/auth/mcpOAuthHelpers';
import type { IOAuthTokenStore, OAuthClientRecord, OAuthToken } from '../mcp/auth/types';
import {
  authorizeMcpServerRoute,
  deleteMcpServerAuthRoute,
  getMcpServerCatalogRoute,
  getMcpServerRoute,
  listAvailableMcpServersRoute,
  listMcpServersRoute,
  listMcpServerToolsRoute,
  putMcpServerRoute,
} from '../routes/mcpServerRoutes';
import { getMcpConnection } from '../runtime/sessionResources';
import type { ConfiguredMcpServer, McpAuthStatus, McpServerManifest, McpServerReadEntry } from '../schemas/mcpServer';
import { resolveMcpAuthStatus } from '../schemas/mcpServer';
import { MissingStoredSecretError, resolveStoredSecretValue, toRedactedSecretValue } from '../utils/secretRedaction';
import { TENANT_ID } from './sessions';

export interface SettingsMcpServersRouterDeps<TTransaction> {
  mcpCatalog: McpCatalog;
  mcpServerStore: IMcpServerStore<TTransaction>;
  tokenStore: IOAuthTokenStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  logger: Logger;
  resolveUserContext: ResolveUserContext;
}

export interface McpServersRouterDeps<TTransaction> {
  mcpServerStore: IMcpServerStore<TTransaction>;
  tokenStore: IOAuthTokenStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  logger: Logger;
  resolveUserContext: ResolveUserContext;
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

/** Settings wire view: redact header secrets; leave DCR / no-auth manifests unchanged. */
function redactMcpServerManifest(manifest: McpServerManifest): McpServerManifest {
  if (manifest.auth?.type !== 'header') {
    return manifest;
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(manifest.auth.headers)) {
    headers[name] = toRedactedSecretValue(value);
  }
  return {
    ...manifest,
    auth: { type: 'header', headers },
  };
}

/**
 * Strict PUT merge for `auth.type === 'header'`: each header value is always required;
 * redacted values keep the stored secret for the same header name.
 * @throws {MissingStoredSecretError} when keep is requested without a stored header value
 */
function resolveMcpServerManifestForWrite({
  incoming,
  existing,
}: {
  incoming: McpServerManifest;
  existing: McpServerManifest | undefined;
}): McpServerManifest {
  if (incoming.auth?.type !== 'header') {
    return incoming;
  }
  const existingHeaders = existing?.auth?.type === 'header' ? existing.auth.headers : undefined;
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(incoming.auth.headers)) {
    headers[name] = resolveStoredSecretValue({
      incoming: value,
      existing: existingHeaders?.[name],
    });
  }
  return {
    ...incoming,
    auth: { type: 'header', headers },
  };
}

/**
 * `token` is the calling user's DCR access token for this server (keyed by `record.id` +
 * `userRef`), or undefined for header/no-auth servers and DCR servers that have never
 * authorized for this user. Only DCR reads it.
 */
function toConfiguredMcpServer({
  record,
  token,
}: {
  record: McpServerRecord;
  token: OAuthToken | undefined;
}): ConfiguredMcpServer {
  return {
    ...redactMcpServerManifest(record.manifest),
    auth_status: resolveMcpAuthStatus({
      manifest: record.manifest,
      ...(token !== undefined ? { token } : {}),
    }),
  };
}

function toMcpServerReadEntry({
  record,
  token,
}: {
  record: McpServerRecord;
  token: OAuthToken | undefined;
}): McpServerReadEntry {
  const authType = record.manifest.auth?.type;
  return {
    name: record.name,
    url: record.manifest.url,
    ...(authType !== undefined ? { auth: { type: authType } } : {}),
    auth_status: resolveMcpAuthStatus({
      manifest: record.manifest,
      ...(token !== undefined ? { token } : {}),
    }),
  };
}

/** Admin/settings MCP CRUD (mounted at /api/v1/settings/mcp-servers). */
export function createSettingsMcpServersRouter<TTransaction>(deps: SettingsMcpServersRouterDeps<TTransaction>) {
  const catalogHandler: RouteHandler<typeof getMcpServerCatalogRoute> = c => {
    return c.json({ data: [...deps.mcpCatalog.list()] }, 200);
  };

  const listHandler: RouteHandler<typeof listMcpServersRoute> = async c => {
    const userRef = deps.resolveUserContext(c).userRef;
    const records = await deps.mcpServerStore.listServers({ tenant_id: TENANT_ID, names: undefined });
    // Only DCR servers have tokens; batch the lookup for this user.
    const dcrIds = records.filter(record => record.manifest.auth?.type === 'dcr').map(record => record.id);
    const tokens = await deps.tokenStore.getTokens({ ids: dcrIds, userRef });
    return c.json(
      { data: records.map(record => toConfiguredMcpServer({ record, token: tokens.get(record.id) })) },
      200,
    );
  };

  const getHandler: RouteHandler<typeof getMcpServerRoute> = async c => {
    const { name } = c.req.valid('param');
    const userRef = deps.resolveUserContext(c).userRef;
    const record = await deps.mcpServerStore.getServer({ tenant_id: TENANT_ID, name });
    if (!record) {
      return c.json({ error: { message: `MCP server not found: ${name}` } }, 404);
    }
    let token: OAuthToken | undefined;
    if (record.manifest.auth?.type === 'dcr') {
      token = await deps.tokenStore.getToken({ id: record.id, userRef });
    }
    return c.json({ data: toConfiguredMcpServer({ record, token }) }, 200);
  };

  const putHandler: RouteHandler<typeof putMcpServerRoute> = async c => {
    const userRef = deps.resolveUserContext(c).userRef;
    const incomingManifest: McpServerManifest = c.req.valid('json');
    // Unlocked snapshot only for pre-txn DCR HTTP (remote I/O cannot run inside withTransaction).
    // Header secret keep/rotate is re-resolved under getServerForUpdate inside the txn below.
    const prior = await deps.mcpServerStore.getServer({ tenant_id: TENANT_ID, name: incomingManifest.name });

    // DCR HTTP must finish before the txn so a failed registration never leaves a half-written row
    // (txn cannot roll back the AS, and AGENTS forbids remote I/O inside withTransaction).
    // Per-request OAuth timeouts live on mcpOAuthFetch (MCP_OAUTH_HTTP_TIMEOUT_MS) — no outer
    // withTimeout, so hung AS failures surface as TimeoutError with the intended message.
    let dcrClientToSave: OAuthClientRecord | undefined;
    if (incomingManifest.auth?.type === 'dcr') {
      const existingClient = prior !== undefined ? await deps.mcpServerStore.getClient({ id: prior.id }) : undefined;
      // Register when: brand-new server, client was cleared (e.g. invalid_client), or MCP URL changed
      // (resource/AS may differ; reuse would keep stale oauth_server/client for the old AS).
      // TODO: make manifest URL immutable after create so re-DCR / stale OAuth tokens are not possible via PUT.
      const urlChanged = prior !== undefined && prior.manifest.url !== incomingManifest.url;
      const needsDcr = existingClient === undefined || urlChanged;
      if (needsDcr) {
        try {
          dcrClientToSave = await createMcpOAuthClient({
            mcpServerUrl: incomingManifest.url,
            mcpServerName: incomingManifest.name,
            redirectUri: mcpOAuthCallbackUrl(),
            clientName: configuration.MCP_DCR_OAUTH_CLIENT_NAME,
          });
        } catch (error) {
          deps.logger.error(
            `DCR client registration failed for "${incomingManifest.name}"; rejecting upsert`,
            extractErrorLogFields(error),
          );
          const message =
            error instanceof Error ? error.message : 'Failed to register OAuth client for this MCP server';
          return c.json({ error: { message } }, 422);
        }
      }
    }

    try {
      // Lock → resolve secrets from that snapshot → upsert, all in one txn so concurrent keep
      // cannot re-write a secret over a rotate that committed in between.
      const record = await deps.withTransaction(async transaction => {
        const existing = await deps.mcpServerStore.getServerForUpdate(
          { tenant_id: TENANT_ID, name: incomingManifest.name },
          transaction,
        );
        const manifest = resolveMcpServerManifestForWrite({
          incoming: incomingManifest,
          existing: existing?.manifest,
        });
        const saved = await deps.mcpServerStore.upsertServer(
          {
            tenant_id: TENANT_ID,
            name: manifest.name,
            manifest,
          },
          transaction,
        );
        if (dcrClientToSave !== undefined) {
          // New DCR registration (create, missing client, or URL change): replace the shared client only.
          // Existing per-user tokens are left in place; resolve/refresh fails them if they no longer
          // match the new resource/AS, and users re-authorize from there.
          await deps.mcpServerStore.saveClient({ id: saved.id, record: dcrClientToSave }, transaction);
        }
        return saved;
      });

      // A re-upsert preserves `id`, so a DCR server may already carry a token from a prior authorize.
      const token =
        record.manifest.auth?.type === 'dcr' ? await deps.tokenStore.getToken({ id: record.id, userRef }) : undefined;
      return c.json({ data: toConfiguredMcpServer({ record, token }) }, 200);
    } catch (error) {
      if (error instanceof MissingStoredSecretError) {
        return c.json({ error: { message: 'Header secret is required' } }, 400);
      }
      throw error;
    }
  };

  const listToolsHandler: RouteHandler<typeof listMcpServerToolsRoute> = async c => {
    const { name } = c.req.valid('param');
    const userRef = deps.resolveUserContext(c).userRef;
    // Same url + header resolution as turn execution (DCR via resolveMcpAuth, header/no-auth static).
    const connection = await getMcpConnection({
      tenant_id: TENANT_ID,
      name,
      store: deps.mcpServerStore,
      tokenStore: deps.tokenStore,
      clientName: configuration.MCP_DCR_OAUTH_CLIENT_NAME,
      userRef,
    });
    if (connection === undefined) {
      return c.json({ error: { message: `MCP server not found: ${name}` } }, 404);
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
        return c.json({ error: { message: `MCP server "${name}" requires authentication` } }, 422);
      }
      const data = response.result.tools.map(tool => omitUndefinedEntries({ ...tool }));
      return c.json({ data }, 200);
    } catch (error) {
      if (error instanceof McpConnectionError) {
        deps.logger.warn(`MCP tools/list failed for "${name}"`, extractErrorLogFields(error));
        if (error.statusCode === 401) {
          return c.json({ error: { message: error.message } }, 422);
        }
        return c.json({ error: { message: error.message } }, 502);
      }
      throw error;
    }
  };

  const router = new OpenAPIHono();
  // Static `/catalog` before `/{name}/…` so "catalog" is not captured as a name.
  router.openapi(getMcpServerCatalogRoute, catalogHandler);
  router.openapi(listMcpServersRoute, listHandler);
  router.openapi(putMcpServerRoute, putHandler);
  // `/{name}/tools` before `/{name}` so the tools suffix is not swallowed.
  router.openapi(listMcpServerToolsRoute, listToolsHandler);
  router.openapi(getMcpServerRoute, getHandler);
  return router;
}

/** List + authorize (mounted at /api/v1/mcp-servers). */
export function createMcpServersRouter<TTransaction>(deps: McpServersRouterDeps<TTransaction>) {
  const authorizeHandler: RouteHandler<typeof authorizeMcpServerRoute> = async c => {
    const { name } = c.req.valid('param');
    const { redirect_url: redirectUrl } = c.req.valid('query');
    const userRef = deps.resolveUserContext(c).userRef;
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
        userRef,
        mcpServerUrl: record.manifest.url,
        mcpServerName: record.name,
        clientName: configuration.MCP_DCR_OAUTH_CLIENT_NAME,
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
        if (error.statusCode === 422) {
          return c.json({ error: { message: error.message } }, 422);
        }
        if (error.statusCode === 424) {
          return c.json({ error: { message: error.message } }, 424);
        }
        return c.json({ error: { message: error.message } }, 500);
      }
      deps.logger.error(`MCP authorize unexpected failure for "${name}"`, extractErrorLogFields(error));
      return c.json({ error: { message: 'Internal server error' } }, 500);
    }
  };

  const deleteAuthHandler: RouteHandler<typeof deleteMcpServerAuthRoute> = async c => {
    const { name } = c.req.valid('param');
    const userRef = deps.resolveUserContext(c).userRef;
    const record = await deps.mcpServerStore.getServer({ tenant_id: TENANT_ID, name });
    if (!record) {
      return c.json({ error: { message: `MCP server not found: ${name}` } }, 404);
    }
    // DCR: drop this user's token only — keep oauth_server / oauth_client so re-authorize can skip DCR.
    // Header / no-auth: no-op.
    if (record.manifest.auth?.type === 'dcr') {
      await deps.tokenStore.deleteToken({ id: record.id, userRef });
    }
    return c.json({ data: toConfiguredMcpServer({ record, token: undefined }) }, 200);
  };

  const router = new OpenAPIHono();
  router.openapi(listAvailableMcpServersRoute, async c => {
    const userRef = deps.resolveUserContext(c).userRef;
    const records = await deps.mcpServerStore.listServers({ tenant_id: TENANT_ID, names: undefined });
    const dcrIds = records.filter(record => record.manifest.auth?.type === 'dcr').map(record => record.id);
    const tokens = await deps.tokenStore.getTokens({ ids: dcrIds, userRef });
    return c.json(
      {
        data: records.map(record => toMcpServerReadEntry({ record, token: tokens.get(record.id) })),
      },
      200,
    );
  });
  router.openapi(authorizeMcpServerRoute, authorizeHandler);
  router.openapi(deleteMcpServerAuthRoute, deleteAuthHandler);
  return router;
}
