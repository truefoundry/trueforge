import type { RemoteMcpHeaders } from '@truefoundry/trueforge-core/core';
import {
  McpServerNotFoundError,
  type GetMcpServerInput,
  type IMcpServerStore,
  type McpServerRecord,
} from '../db/mcpServerStore';
import type { TurnMetadata } from '../db/turnMetadata';
import { isMcpAuthRequired, resolveMcpAuth } from '../mcp/auth/mcpDcr';
import type { IOAuthClientStore, IOAuthTokenStore } from '../mcp/auth/types';
import { resolveConfiguredMcpRequestHeaders, resolveMcpAuthStatus, type McpAuthStatus } from '../schemas/mcpServer';

export interface ResolveMcpAuthStatusesInput {
  records: readonly McpServerRecord[];
  userRef: string;
}

export interface AuthorizeMcpServerInput {
  tenant_id: string;
  name: string;
  userRef: string;
  /** Same-origin relative path to land after consent. */
  returnTo?: string;
}

export interface DeleteMcpAuthorizationInput {
  tenant_id: string;
  name: string;
  userRef: string;
}

export interface ResolveMcpInvokeHeadersInput {
  record: McpServerRecord;
  userRef: string;
  turnMetadata?: TurnMetadata;
}

export interface IMcpServerResolver {
  getServer(input: GetMcpServerInput): Promise<McpServerRecord | undefined>;
  resolveAuthStatuses(input: ResolveMcpAuthStatusesInput): Promise<ReadonlyMap<string, McpAuthStatus>>;
  authorize(input: AuthorizeMcpServerInput): Promise<McpAuthStatus>;
  deleteAuthorization(input: DeleteMcpAuthorizationInput): Promise<void>;
  resolveInvokeHeaders(input: ResolveMcpInvokeHeadersInput): RemoteMcpHeaders;
}

export class McpServerResolver<TTransaction = never> implements IMcpServerResolver {
  readonly #store: IMcpServerStore<TTransaction> & IOAuthClientStore<TTransaction>;
  readonly #tokenStore: IOAuthTokenStore<TTransaction>;
  readonly #clientName: string;

  constructor(input: {
    store: IMcpServerStore<TTransaction> & IOAuthClientStore<TTransaction>;
    tokenStore: IOAuthTokenStore<TTransaction>;
    clientName: string;
  }) {
    this.#store = input.store;
    this.#tokenStore = input.tokenStore;
    this.#clientName = input.clientName;
  }

  getServer(input: GetMcpServerInput): Promise<McpServerRecord | undefined> {
    return this.#store.getServer(input);
  }

  resolveInvokeHeaders(input: ResolveMcpInvokeHeadersInput): RemoteMcpHeaders {
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
