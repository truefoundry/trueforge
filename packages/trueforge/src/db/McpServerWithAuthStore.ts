import type { RemoteMcpHeaders, ResolveHeadersResult } from '@truefoundry/trueforge-core/core';
import { isMcpAuthRequired, resolveMcpAuth } from '../mcp/auth/mcpDcr';
import type { IOAuthTokenStore, OAuthClientRecord } from '../mcp/auth/types';
import {
  hasAuthorizationHeader,
  isVirtualMcpHeaders,
  overrideHeaders,
  withoutAuthorization,
  X_TFY_MCP_HEADERS,
  type PerServerMcpHeaders,
} from '../mcp/perServerMcpHeaders';
import { resolveConfiguredMcpRequestHeaders, resolveMcpAuthStatus, type McpAuthStatus } from '../schemas/mcpServer';
import {
  McpServerNotFoundError,
  type AuthorizeMcpServerInput,
  type CreateMcpServerInput,
  type DeleteMcpAuthorizationInput,
  type DeleteMcpServerInput,
  type GetMcpServerInput,
  type IMcpServerStore,
  type IMcpServerWithAuthStore,
  type ListMcpServersInput,
  type McpServerRecord,
  type ResolveMcpAuthStatusesInput,
  type UpsertMcpServerInput,
} from './mcpServerStore';
import type { TurnMetadata } from './turnMetadata';

async function resolveWithOverride(input: {
  headers: RemoteMcpHeaders;
  override: Record<string, string>;
}): Promise<ResolveHeadersResult> {
  const result = typeof input.headers === 'function' ? await input.headers() : { headers: input.headers };
  if ('authRequired' in result) {
    return result;
  }
  return { headers: overrideHeaders({ base: result.headers, override: input.override }) };
}

export class McpServerWithAuthStore<TTransaction = never> implements IMcpServerWithAuthStore<TTransaction> {
  readonly #store: IMcpServerStore<TTransaction>;
  readonly #tokenStore: IOAuthTokenStore<TTransaction>;
  readonly #clientName: string;
  readonly #perServerHeaders: PerServerMcpHeaders;

  constructor(input: {
    store: IMcpServerStore<TTransaction>;
    tokenStore: IOAuthTokenStore<TTransaction>;
    clientName: string;
    perServerHeaders?: PerServerMcpHeaders;
  }) {
    this.#store = input.store;
    this.#tokenStore = input.tokenStore;
    this.#clientName = input.clientName;
    this.#perServerHeaders = input.perServerHeaders ?? {};
  }

  listServers(input: ListMcpServersInput, transaction?: TTransaction): Promise<McpServerRecord[]> {
    return this.#store.listServers(input, transaction);
  }

  getServer(input: GetMcpServerInput, transaction?: TTransaction): Promise<McpServerRecord | undefined> {
    return this.#store.getServer(input, transaction);
  }

  getServerForUpdate(input: GetMcpServerInput, transaction: TTransaction): Promise<McpServerRecord | undefined> {
    return this.#store.getServerForUpdate(input, transaction);
  }

  createServer(input: CreateMcpServerInput, transaction?: TTransaction): Promise<McpServerRecord> {
    return this.#store.createServer(input, transaction);
  }

  upsertServer(input: UpsertMcpServerInput, transaction?: TTransaction): Promise<McpServerRecord> {
    return this.#store.upsertServer(input, transaction);
  }

  deleteServer(input: DeleteMcpServerInput, transaction?: TTransaction): Promise<boolean> {
    return this.#store.deleteServer(input, transaction);
  }

  /** Caller headers for the server go straight to it; one with Authorization skips its consent flow. */
  resolveInvokeHeaders(input: {
    record: McpServerRecord;
    userRef: string;
    turnMetadata?: TurnMetadata;
  }): RemoteMcpHeaders {
    const registered = this.#resolveRegisteredHeaders(input);
    const callerHeaders = this.#perServerHeaders[input.record.name];
    if (callerHeaders === undefined) {
      return registered;
    }
    if (isVirtualMcpHeaders(callerHeaders)) {
      const override = { [X_TFY_MCP_HEADERS]: JSON.stringify(callerHeaders) };
      return () => resolveWithOverride({ headers: registered, override });
    }
    if (hasAuthorizationHeader(callerHeaders)) {
      const headers = overrideHeaders({
        base: resolveConfiguredMcpRequestHeaders(input.record.manifest),
        override: callerHeaders,
      });
      const override = withoutAuthorization(callerHeaders);
      return () =>
        Promise.resolve({ headers, onUnauthorized: () => resolveWithOverride({ headers: registered, override }) });
    }
    return () => resolveWithOverride({ headers: registered, override: callerHeaders });
  }

  #resolveRegisteredHeaders(input: { record: McpServerRecord; userRef: string }): RemoteMcpHeaders {
    const { record, userRef } = input;
    if (record.manifest.auth?.type === 'dcr') {
      return async () => {
        const result = await resolveMcpAuth({
          tokenStore: this.#tokenStore,
          mcpServerStore: this.#store,
          serverId: record.id,
          userRef,
          mcpServerUrl: record.manifest.url,
          mcpServerName: record.name,
          clientName: this.#clientName,
        });
        if (isMcpAuthRequired(result)) {
          // Wire `id` must match RemoteMCP.id (AgentSpec name), not the DB row ULID.
          return {
            authRequired: {
              servers: [{ id: record.name, name: record.name, auth_url: result.authUrl.href }],
            },
          };
        }
        return { headers: result.headers };
      };
    }
    return resolveConfiguredMcpRequestHeaders(record.manifest);
  }

  saveClient(params: { id: string; record: OAuthClientRecord }, transaction?: TTransaction): Promise<void> {
    return this.#store.saveClient(params, transaction);
  }

  getClient(params: { id: string }, transaction?: TTransaction): Promise<OAuthClientRecord | undefined> {
    return this.#store.getClient(params, transaction);
  }

  deleteClient(params: { id: string }, transaction?: TTransaction): Promise<void> {
    return this.#store.deleteClient(params, transaction);
  }

  async resolveAuthStatuses(input: ResolveMcpAuthStatusesInput): Promise<ReadonlyMap<string, McpAuthStatus>> {
    const dcrIds = input.records.filter(record => record.manifest.auth?.type === 'dcr').map(record => record.id);
    const tokens = await this.#tokenStore.getTokens({ ids: dcrIds, userRef: input.userRef });
    const out = new Map<string, McpAuthStatus>();
    for (const record of input.records) {
      const token = tokens.get(record.id);
      out.set(
        record.name,
        resolveMcpAuthStatus({
          manifest: record.manifest,
          ...(token !== undefined ? { token } : {}),
        }),
      );
    }
    return out;
  }

  async authorize(input: AuthorizeMcpServerInput): Promise<McpAuthStatus> {
    const record = await this.#store.getServer({ tenant_id: input.tenant_id, name: input.name });
    if (record === undefined) {
      throw new McpServerNotFoundError(input.name);
    }
    if (record.manifest.auth?.type !== 'dcr') {
      return resolveMcpAuthStatus({ manifest: record.manifest });
    }
    const result = await resolveMcpAuth({
      tokenStore: this.#tokenStore,
      mcpServerStore: this.#store,
      serverId: record.id,
      userRef: input.userRef,
      mcpServerUrl: record.manifest.url,
      mcpServerName: record.name,
      clientName: this.#clientName,
      ...(input.returnTo !== undefined ? { returnTo: input.returnTo } : {}),
    });
    return isMcpAuthRequired(result)
      ? { status: 'auth_required', authorization_url: result.authUrl.href }
      : { status: 'authenticated' };
  }

  async deleteAuthorization(input: DeleteMcpAuthorizationInput): Promise<void> {
    const record = await this.#store.getServer({ tenant_id: input.tenant_id, name: input.name });
    if (record === undefined) {
      throw new McpServerNotFoundError(input.name);
    }
    if (record.manifest.auth?.type === 'dcr') {
      await this.#tokenStore.deleteToken({ id: record.id, userRef: input.userRef });
    }
  }
}
