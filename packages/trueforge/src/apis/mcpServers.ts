import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { InvalidPageTokenError } from '@truefoundry/trueforge-core/agent-session';
import { extractErrorLogFields, isAuthRequired, McpConnectionError, RemoteMCP } from '@truefoundry/trueforge-core/core';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Logger } from 'winston';
import type { ResolveRequestContext } from '../auth/identity';
import { safeReturnTo } from '../auth/safeReturnTo';
import configuration from '../config';
import {
  McpServerNameConflictError,
  McpServerNotFoundError,
  type IMcpServerWithAuthStore,
  type McpServerRecord,
} from '../db/mcpServerStore';
import type { WithTransaction } from '../db/transaction';
import { createMcpOAuthClient } from '../mcp/auth/mcpDcr';
import { mcpOAuthCallbackUrl } from '../mcp/auth/mcpOAuthHelpers';
import type { IOAuthTokenStore, OAuthClientRecord } from '../mcp/auth/types';
import {
  authorizeMcpServerRoute,
  createMcpServerRoute,
  deleteAuthorizationMcpServerRoute,
  getMcpServerRoute,
  listAvailableMcpServersRoute,
  listMcpServersRoute,
  listMcpServerToolsRoute,
  putMcpServerRoute,
} from '../routes/mcpServerRoutes';
import { getMcpConnection } from '../runtime/sessionResources';
import type {
  AvailableMcpServer,
  ConfiguredMcpServer,
  CreateMcpServerRequest,
  McpAuthStatus,
  McpServerManifest,
  UpdateMcpServerRequest,
} from '../schemas/mcpServer';
import { MissingStoredSecretError, resolveStoredSecretValue, toRedactedSecretValue } from '../utils/secretRedaction';

export interface McpServersRouterDeps<TTransaction> {
  resolveMcpServerStore: (c: Context) => IMcpServerWithAuthStore<TTransaction>;
  tokenStore: IOAuthTokenStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  logger: Logger;
  resolveRequestContext: ResolveRequestContext;
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

async function toConfiguredMcpServer<TTransaction>(params: {
  store: IMcpServerWithAuthStore<TTransaction>;
  record: McpServerRecord;
  userRef: string;
}): Promise<ConfiguredMcpServer> {
  const statuses = await params.store.resolveAuthStatuses({
    records: [params.record],
    userRef: params.userRef,
  });
  return {
    name: params.record.name,
    manifest: redactMcpServerManifest(params.record.manifest),
    auth_status: statuses.get(params.record.name) ?? { status: 'auth_required' },
  };
}

/** Admin/settings MCP CRUD. */
export function createSettingsMcpServersRouter<TTransaction>(deps: McpServersRouterDeps<TTransaction>) {
  const listHandler: RouteHandler<typeof listMcpServersRoute> = async c => {
    const requestContext = deps.resolveRequestContext(c);
    const userRef = requestContext.subject.id;
    const { limit, page_token: pageToken } = c.req.valid('query');
    try {
      const { data: records, pagination } = await deps.resolveMcpServerStore(c).listServers({
        tenant_id: requestContext.tenant_id,
        names: undefined,
        limit,
        page_token: pageToken,
      });
      const statuses = await deps.resolveMcpServerStore(c).resolveAuthStatuses({
        records,
        userRef,
      });
      const data: ConfiguredMcpServer[] = records.map(record => ({
        name: record.name,
        manifest: redactMcpServerManifest(record.manifest),
        auth_status: statuses.get(record.name) ?? { status: 'auth_required' },
      }));
      return c.json({ data, pagination }, 200);
    } catch (error) {
      if (error instanceof InvalidPageTokenError) {
        return c.json({ error: { message: error.message } }, 400);
      }
      throw error;
    }
  };

  const getHandler: RouteHandler<typeof getMcpServerRoute> = async c => {
    const { name } = c.req.valid('param');
    const requestContext = deps.resolveRequestContext(c);
    const userRef = requestContext.subject.id;
    const record = await deps.resolveMcpServerStore(c).getServer({
      tenant_id: requestContext.tenant_id,
      name,
    });
    if (!record) {
      return c.json({ error: { message: `MCP server not found: ${name}` } }, 404);
    }
    return c.json(
      {
        data: await toConfiguredMcpServer({
          store: deps.resolveMcpServerStore(c),
          record,
          userRef,
        }),
      },
      200,
    );
  };

  const createHandler: RouteHandler<typeof createMcpServerRoute> = async c => {
    const body: CreateMcpServerRequest = c.req.valid('json');
    const requestContext = deps.resolveRequestContext(c);
    const incomingManifest = body.manifest;

    // DCR finishes before the txn (remote I/O stays out of withTransaction on create).
    let dcrClientToSave: OAuthClientRecord | undefined;
    if (incomingManifest.auth?.type === 'dcr') {
      try {
        dcrClientToSave = await createMcpOAuthClient({
          mcpServerUrl: incomingManifest.url,
          mcpServerName: incomingManifest.name,
          redirectUri: mcpOAuthCallbackUrl(),
          clientName: configuration.MCP_DCR_OAUTH_CLIENT_NAME,
        });
      } catch (error) {
        deps.logger.error(
          `DCR client registration failed for "${incomingManifest.name}"; rejecting create`,
          extractErrorLogFields(error),
        );
        const message = error instanceof Error ? error.message : 'Failed to register OAuth client for this MCP server';
        return c.json({ error: { message } }, 422);
      }
    }

    let manifest: McpServerManifest;
    try {
      manifest = resolveMcpServerManifestForWrite({
        incoming: incomingManifest,
        existing: undefined,
      });
    } catch (error) {
      if (error instanceof MissingStoredSecretError) {
        return c.json({ error: { message: 'Header secret is required' } }, 400);
      }
      throw error;
    }

    try {
      const record = await deps.withTransaction(async transaction => {
        const saved = await deps.resolveMcpServerStore(c).createServer(
          {
            tenant_id: requestContext.tenant_id,
            name: manifest.name,
            manifest,
          },
          transaction,
        );
        if (dcrClientToSave !== undefined) {
          await deps.resolveMcpServerStore(c).saveClient({ id: saved.id, record: dcrClientToSave }, transaction);
        }
        return saved;
      });

      return c.json(
        {
          data: await toConfiguredMcpServer({
            store: deps.resolveMcpServerStore(c),
            record,
            userRef: requestContext.subject.id,
          }),
        },
        201,
      );
    } catch (error) {
      if (error instanceof McpServerNameConflictError) {
        return c.json({ error: { message: error.message } }, 409);
      }
      throw error;
    }
  };

  const putHandler: RouteHandler<typeof putMcpServerRoute> = async c => {
    const requestContext = deps.resolveRequestContext(c);
    const userRef = requestContext.subject.id;
    const body: UpdateMcpServerRequest = c.req.valid('json');
    const incomingManifest = body.manifest;

    try {
      // Lock → resolve secrets → DCR (if needed) → upsert + saveClient in one txn.
      // Exception: MCP put may run `createMcpOAuthClient` inside the write txn that persists
      // `oauth_server`/`oauth_client` so a failed registration rolls back the server write.
      // Bounded by `MCP_OAUTH_HTTP_TIMEOUT_MS` (15s);
      // must stay under `POSTGRES_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS` (30s).
      const record = await deps.withTransaction(async transaction => {
        const existing = await deps
          .resolveMcpServerStore(c)
          .getServerForUpdate({ tenant_id: requestContext.tenant_id, name: incomingManifest.name }, transaction);
        const manifest = resolveMcpServerManifestForWrite({
          incoming: incomingManifest,
          existing: existing?.manifest,
        });

        let dcrClientToSave: OAuthClientRecord | undefined;
        const urlChanged =
          existing !== undefined && existing.manifest.url !== manifest.url && manifest.auth?.type === 'dcr';
        if (manifest.auth?.type === 'dcr') {
          const existingClient = existing
            ? await deps.resolveMcpServerStore(c).getClient({ id: existing.id }, transaction)
            : undefined;
          // Register when: brand-new server, client was cleared (e.g. invalid_client), or MCP URL changed
          // (resource/AS may differ; reuse would keep stale oauth_server/client for the old AS).
          const needsDcr = existingClient === undefined || urlChanged;
          if (needsDcr) {
            dcrClientToSave = await createMcpOAuthClient({
              mcpServerUrl: manifest.url,
              mcpServerName: manifest.name,
              redirectUri: mcpOAuthCallbackUrl(),
              clientName: configuration.MCP_DCR_OAUTH_CLIENT_NAME,
            });
          }
        }

        const saved = await deps.resolveMcpServerStore(c).upsertServer(
          {
            tenant_id: requestContext.tenant_id,
            name: manifest.name,
            manifest,
          },
          transaction,
        );
        if (dcrClientToSave !== undefined) {
          // New DCR registration (create, missing client, or URL change): replace the shared client.
          await deps.resolveMcpServerStore(c).saveClient({ id: saved.id, record: dcrClientToSave }, transaction);
        }
        if (urlChanged) {
          // URL is the OAuth resource/audience — drop every user's tokens and in-flight authorizes.
          await deps.tokenStore.deleteTokensForServer({ id: saved.id }, transaction);
          await deps.tokenStore.deletePendingAuthorizationsForServer({ id: saved.id }, transaction);
        }
        return saved;
      });

      return c.json(
        {
          data: await toConfiguredMcpServer({
            store: deps.resolveMcpServerStore(c),
            record,
            userRef,
          }),
        },
        200,
      );
    } catch (error) {
      if (error instanceof MissingStoredSecretError) {
        return c.json({ error: { message: 'Header secret is required' } }, 400);
      }
      if (error instanceof McpConnectionError) {
        deps.logger.error(
          `DCR client registration failed for "${incomingManifest.name}"; rejecting upsert`,
          extractErrorLogFields(error),
        );
        return c.json({ error: { message: error.message } }, 422);
      }
      throw error;
    }
  };

  const router = new OpenAPIHono();
  router.openapi(listMcpServersRoute, listHandler);
  router.openapi(createMcpServerRoute, createHandler);
  router.openapi(putMcpServerRoute, putHandler);
  router.openapi(getMcpServerRoute, getHandler);
  return router;
}

/** Chat list, tools, and authorize. */
export function createMcpServersRouter<TTransaction>(deps: McpServersRouterDeps<TTransaction>) {
  const authorizeHandler: RouteHandler<typeof authorizeMcpServerRoute> = async c => {
    const { name } = c.req.valid('param');
    const { return_to: returnTo } = c.req.valid('query');
    const requestContext = deps.resolveRequestContext(c);
    const userRef = requestContext.subject.id;

    if (returnTo && safeReturnTo(returnTo) !== returnTo) {
      return c.json({ error: { message: 'Invalid return_to: must be a same-origin relative path' } }, 400);
    }

    try {
      const authStatus: McpAuthStatus = await deps.resolveMcpServerStore(c).authorize({
        tenant_id: requestContext.tenant_id,
        name,
        userRef,
        ...(returnTo !== undefined ? { returnTo } : {}),
      });
      return c.json(authStatus, 200);
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }
      if (error instanceof McpServerNotFoundError) {
        return c.json({ error: { message: error.message } }, 404);
      }
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

  const listToolsHandler: RouteHandler<typeof listMcpServerToolsRoute> = async c => {
    const { name } = c.req.valid('param');
    const requestContext = deps.resolveRequestContext(c);
    const userRef = requestContext.subject.id;
    // Same url + header resolution as turn execution (store Bearer, DCR, or static headers).
    const connection = await getMcpConnection({
      tenant_id: requestContext.tenant_id,
      name,
      store: deps.resolveMcpServerStore(c),
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

  const deleteAuthorizationHandler: RouteHandler<typeof deleteAuthorizationMcpServerRoute> = async c => {
    const { name } = c.req.valid('param');
    const requestContext = deps.resolveRequestContext(c);
    const userRef = requestContext.subject.id;
    try {
      const record = await deps.resolveMcpServerStore(c).getServer({
        tenant_id: requestContext.tenant_id,
        name,
      });
      if (!record) {
        return c.json({ error: { message: `MCP server not found: ${name}` } }, 404);
      }
      await deps.resolveMcpServerStore(c).deleteAuthorization({
        tenant_id: requestContext.tenant_id,
        name,
        userRef,
      });
      return c.json(
        {
          data: await toConfiguredMcpServer({
            store: deps.resolveMcpServerStore(c),
            record,
            userRef,
          }),
        },
        200,
      );
    } catch (error) {
      if (error instanceof McpServerNotFoundError) {
        return c.json({ error: { message: error.message } }, 404);
      }
      throw error;
    }
  };

  const router = new OpenAPIHono();
  router.openapi(listAvailableMcpServersRoute, async c => {
    const requestContext = deps.resolveRequestContext(c);
    const userRef = requestContext.subject.id;
    const { limit, page_token: pageToken } = c.req.valid('query');
    try {
      const { data: records, pagination } = await deps.resolveMcpServerStore(c).listServers({
        tenant_id: requestContext.tenant_id,
        names: undefined,
        limit,
        page_token: pageToken,
      });
      const statuses = await deps.resolveMcpServerStore(c).resolveAuthStatuses({
        records,
        userRef,
      });
      const data: AvailableMcpServer[] = records.map(record => {
        const authType = record.manifest.auth?.type;
        return {
          name: record.name,
          url: record.manifest.url,
          ...(authType !== undefined ? { auth: { type: authType } } : {}),
          auth_status: statuses.get(record.name) ?? { status: 'auth_required' },
        };
      });
      return c.json({ data, pagination }, 200);
    } catch (error) {
      if (error instanceof InvalidPageTokenError) {
        return c.json({ error: { message: error.message } }, 400);
      }
      throw error;
    }
  });
  router.openapi(listMcpServerToolsRoute, listToolsHandler);
  router.openapi(authorizeMcpServerRoute, authorizeHandler);
  router.openapi(deleteAuthorizationMcpServerRoute, deleteAuthorizationHandler);
  return router;
}
